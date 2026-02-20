# Correctif: Envoi de Messages dans les Canaux Publics

## Description du Problème
Les utilisateurs ne pouvaient pas envoyer de messages dans les canaux publics immédiatement après le chargement de l'application. Le problème se résolvait "mystérieusement" après l'envoi d'un message privé ou un rechargement spécifique.

## Analyse de la Cause Racine
L'analyse a révélé que la fonction `join_room` de Flask-SocketIO était appelée avec des identifiants de type mixte (entier vs chaîne de caractères).
- Dans `handle_connect` (auto-join), l'ID était passé comme entier (venant de la DB).
- Dans d'autres parties de l'application, les IDs pouvaient être traités comme des chaînes.
- Flask-SocketIO/Socket.IO gère les salles "123" et 123 comme deux salles distinctes.
- Le client émettait vers la salle string, mais l'utilisateur était auto-joint à la salle int (ou vice versa), créant une discordance.

## Modifications Appliquées

### 1. Serveur (`app.py`)
Nous avons forcé la conversion en chaîne de caractères (`str()`) pour tous les appels à `join_room` concernant les canaux :

*   **Auto-join à la connexion (`handle_connect`)** :
    ```python
    # Avant
    join_room(channel.id)
    # Après
    join_room(str(channel.id))
    ```

*   **Rejoindre un canal (`handle_join_channel`)** :
    ```python
    # Avant
    join_room(channel_id)
    # Après
    join_room(str(channel_id))
    ```

*   **Envoi de message (`handle_send_message`)** :
    Ajout d'une sécurité (join forcé) avec conversion explicite :
    ```python
    join_room(str(channel_id))
    ```

### 2. Client (`static/js/kronos.js`)
Amélioration de la robustesse de la fonction `selectChannel` :
- Ajout de logs pour tracer la tentative de jointure.
- Vérification de l'état de connexion avant d'émettre `join_channel`.

## Validation
Un fichier de test unitaire a été créé : `tests/test_public_message_fix.py`.
Il vérifie que :
1.  `handle_connect` utilise bien des IDs convertis en string.
2.  `handle_send_message` force bien le `join_room` avec un ID string.

Ces modifications garantissent que peu importe le type de données initial (DB ou JSON), l'utilisateur est toujours placé dans la bonne "room" Socket.IO, assurant la réception et l'envoi des messages dès le chargement initial.
