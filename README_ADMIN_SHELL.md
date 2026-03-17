# KRONOS Admin Shell

Interface d'administration pour KRONOS avec CustomTkinter.

## Installation

```bash
pip install -r requirements_admin.txt
```

## Utilisation

### Lancement Automatique V2 (recommandé)
```bash
python app.py
```
L'Admin Shell V2 se lance automatiquement dans un processus indépendant après le démarrage du serveur.

### Mode Local (manuel - V2)
```bash
python admin_shell_v2.py
```

### Mode Distant (surveillance uniquement - V2)
```bash
python admin_shell_v2.py --remote
```

### Ancienne version (dépréciée)
```bash
python admin_shell.py  # Version V1 avec problèmes
```

## Fonctionnalités

### Mode Local
- **Console logs** : Affichage en temps réel des événements du serveur
- **Terminal commandes** : Interface pour les commandes d'administration

### Mode Distant
- **Surveillance** : Affichage des logs à distance
- **Pas de commandes** : Sécurité renforcée

## Commandes du Terminal

Seuls les utilisateurs **Supreme** peuvent exécuter ces commandes :

```bash
help                    # Afficher l'aide
clear                   # Nettoyer le terminal
list                    # Lister les utilisateurs connectés
ban <pseudo>            # Bannir un utilisateur
unban <pseudo>          # Débannir un utilisateur
shadowban <pseudo>      # Shadowbannir un utilisateur
mute <pseudo> <temps>   # Rendre muet (temps en secondes)
kick <pseudo>           # Expulser un utilisateur
info <pseudo>           # Informations sur un utilisateur
```

## Sécurité

- **Supreme uniquement** : Seuls les admins suprêmes peuvent utiliser le terminal
- **Mode distant sécurisé** : Pas de commandes admin à distance
- **Authentification automatique** : Vérification du rôle au démarrage

## Design

- **Thème sombre** : Style Matrix/Terminal
- **Couleurs codées** :
  - 🟢 Vert : Connexions, succès
  - 🔴 Rouge : Bannissements, erreurs
  - 🟡 Jaune : Kicks, mutes
  - 🔵 Bleu : Messages système
  - ⚪ Gris : Déconnexions, infos

## Architecture

- **Socket.IO** : Communication temps réel avec le serveur
- **CustomTkinter** : Interface moderne et responsive
- **Thread-safe** : Gestion des événements concurrents
- **Auto-reconnexion** : Reconnexion automatique en cas de déconnexion
