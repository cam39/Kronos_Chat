# SYSTÈME COMPLET DE CHAT DE GROUPE PRIVÉ KRONOS

## HTML (Interface)

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KRONOS - Chat de Groupe</title>
    <link rel="stylesheet" href="/static/css/style.css">
</head>
<body>
    <!-- Interface principale -->
    <div id="app-container">
        <!-- Barre latérale des conversations -->
        <aside id="sidebar">
            <div id="dm-conversations">
                <h3>Conversations</h3>
                <div id="dm-list">
                    <!-- Bouton "Créer un groupe" -->
                    <div class="create-group-btn" onclick="showCreateGroupModal()">
                        <div class="create-group-content">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="16"/>
                                <line x1="8" y1="12" x2="16" y2="12"/>
                            </svg>
                            <span>Créer un groupe</span>
                        </div>
                    </div>
                    <!-- Liste des conversations (DMs et groupes) -->
                </div>
            </div>
        </aside>

        <!-- Zone de chat principale -->
        <main id="chat-main">
            <!-- En-tête du groupe -->
            <header id="chat-header">
                <div id="channel-info">
                    <h2 id="channel-name">Nom du groupe</h2>
                    <div id="channel-members">
                        <span id="member-count">0 membres</span>
                        <div id="member-list"></div>
                    </div>
                </div>
            </header>

            <!-- Messages -->
            <div id="messages-container">
                <div id="messages-list"></div>
            </div>

            <!-- Zone de saisie -->
            <div id="message-input-container">
                <textarea id="message-input" placeholder="Écrivez un message..."></textarea>
                <button id="send-btn">Envoyer</button>
            </div>
        </main>
    </div>

    <!-- Modale de création de groupe -->
    <div id="create-group-modal" class="modal" style="display: none;">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Créer un groupe</h3>
                <button class="modal-close" onclick="hideCreateGroupModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="group-name">Nom du groupe</label>
                    <input type="text" id="group-name" placeholder="Nom du groupe" required>
                </div>
                <div class="form-group">
                    <label for="group-description">Description</label>
                    <textarea id="group-description" placeholder="Description du groupe"></textarea>
                </div>
                <div class="form-group">
                    <label for="group-type">Type</label>
                    <select id="group-type">
                        <option value="private">Privé</option>
                        <option value="public">Public</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="group-members">Membres</label>
                    <div class="member-selector">
                        <input type="text" id="member-search" placeholder="Rechercher des membres...">
                        <div id="member-suggestions"></div>
                        <div id="selected-members"></div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="createGroup()">Créer le groupe</button>
                <button class="btn btn-secondary" onclick="hideCreateGroupModal()">Annuler</button>
            </div>
        </div>
    </div>

    <!-- Overlay pour les modales -->
    <div id="modal-overlay" style="display: none;" onclick="hideAllModals()"></div>
</body>
</html>
```

## CSS (Styles)

```css
/* ============================================
   STYLES POUR LES GROUPES
   ============================================ */

/* Bouton de création de groupe */
.create-group-btn {
    padding: 12px 16px;
    background: linear-gradient(135deg, var(--accent), var(--accent-hover));
    border-radius: var(--radius-md);
    cursor: pointer;
    margin-bottom: 16px;
    transition: all var(--transition-fast);
}

.create-group-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(204, 255, 0, 0.3);
}

.create-group-content {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--bg-primary);
    font-weight: 600;
}

.create-group-content svg {
    flex-shrink: 0;
}

/* Modale de création de groupe */
.modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal-content {
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
}

.modal-header {
    padding: 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.modal-header h3 {
    color: var(--text-primary);
    margin: 0;
}

.modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
}

.modal-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
}

.modal-body {
    padding: 20px;
}

.modal-footer {
    padding: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 12px;
    justify-content: flex-end;
}

/* Formulaires */
.form-group {
    margin-bottom: 20px;
}

.form-group label {
    display: block;
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 8px;
}

.form-group input,
.form-group textarea,
.form-group select {
    width: 100%;
    padding: 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: inherit;
    transition: all var(--transition-fast);
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(204, 255, 0, 0.2);
}

.form-group textarea {
    resize: vertical;
    min-height: 80px;
}

/* Sélecteur de membres */
.member-selector {
    position: relative;
}

.member-search {
    width: 100%;
    padding: 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    margin-bottom: 12px;
}

#member-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    max-height: 200px;
    overflow-y: auto;
    z-index: 1001;
    display: none;
}

.member-suggestion {
    padding: 12px;
    cursor: pointer;
    transition: background var(--transition-fast);
    display: flex;
    align-items: center;
    gap: 12px;
}

.member-suggestion:hover {
    background: var(--bg-hover);
}

.member-suggestion img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
}

.member-suggestion-info {
    flex: 1;
}

.member-suggestion-name {
    font-weight: 500;
    color: var(--text-primary);
}

.member-suggestion-username {
    font-size: 0.875rem;
    color: var(--text-muted);
}

#selected-members {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.selected-member {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--accent);
    color: var(--bg-primary);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
}

.selected-member-remove {
    cursor: pointer;
    background: none;
    border: none;
    color: inherit;
    padding: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background var(--transition-fast);
}

.selected-member-remove:hover {
    background: rgba(0, 0, 0, 0.2);
}

/* Messages de groupe */
.group-message {
    margin-bottom: 16px;
    display: flex;
    gap: 12px;
}

.group-message-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
}

.group-message-content {
    flex: 1;
}

.group-message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.group-message-author {
    font-weight: 600;
    color: var(--text-primary);
}

.group-message-time {
    font-size: 0.75rem;
    color: var(--text-muted);
}

.group-message-text {
    color: var(--text-primary);
    line-height: 1.5;
}

/* CORRECTION : Bordures Lime pour les embeds de fichiers */
.attachment .file-preview,
.attachment .document-preview,
.attachment .video-preview,
.attachment .audio-preview,
.attachment .image-preview {
    border: 2px solid var(--accent) !important;
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    padding: 12px;
    transition: all var(--transition-fast);
}

.attachment .file-preview:hover,
.attachment .document-preview:hover,
.attachment .video-preview:hover,
.attachment .audio-preview:hover,
.attachment .image-preview:hover {
    border-color: var(--accent-hover) !important;
    box-shadow: 0 0 15px rgba(204, 255, 0, 0.3);
    transform: translateY(-2px);
}

/* CORRECTION : Bouton Play fonctionnel et centrage vidéo */
.video-preview {
    position: relative;
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
}

.video-preview video {
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
    background: #000;
}

.video-preview-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
}

.video-preview-overlay:hover {
    background: rgba(0, 0, 0, 0.5);
}

.video-play-button {
    width: 64px;
    height: 64px;
    background: var(--accent);
    border: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all var(--transition-fast);
}

.video-play-button:hover {
    background: var(--accent-hover);
    transform: scale(1.1);
}

.video-play-button svg {
    width: 24px;
    height: 24px;
    fill: var(--bg-primary);
    margin-left: 2px;
}

/* Boutons */
.btn {
    padding: 12px 24px;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
    font-family: inherit;
}

.btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
}

.btn-primary:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
}

.btn-secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
}

.btn-secondary:hover {
    background: var(--bg-surface);
    border-color: var(--accent);
}

/* Overlay */
#modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
}
```

## JavaScript (Logique Frontend)

```javascript
// ============================================
// SYSTÈME DE GESTION DES GROUPES KRONOS
// ============================================

class KRONOSGroupManager {
    constructor() {
        this.socket = null;
        this.state = {
            currentGroup: null,
            groups: [],
            selectedMembers: [],
            messages: {}
        };
        this.init();
    }

    init() {
        this.setupSocketListeners();
        this.setupEventListeners();
        this.loadGroups();
    }

    // Configuration des écouteurs Socket.IO
    setupSocketListeners() {
        // Connexion
        this.socket.on('connect', () => {
            console.log('[KRONOS] Connecté au serveur');
            this.loadGroups();
        });

        // Messages de groupe
        this.socket.on('new_group_message', (data) => {
            this.handleNewGroupMessage(data);
        });

        // Gestion des groupes
        this.socket.on('group_added', (data) => {
            this.handleGroupAdded(data);
        });

        this.socket.on('group_deleted', (data) => {
            this.handleGroupDeleted(data);
        });

        this.socket.on('group_updated', (data) => {
            this.handleGroupUpdated(data);
        });
    }

    // Configuration des écouteurs d'événements DOM
    setupEventListeners() {
        // Envoi de message
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Recherche de membres
        document.getElementById('member-search').addEventListener('input', (e) => {
            this.searchMembers(e.target.value);
        });

        // Clic sur l'overlay pour fermer les modales
        document.getElementById('modal-overlay').addEventListener('click', () => {
            this.hideAllModals();
        });
    }

    // ============================================
    // GESTION DES GROUPES
    // ============================================

    // Charger les groupes de l'utilisateur
    async loadGroups() {
        try {
            const response = await fetch('/api/groups/list');
            const data = await response.json();
            
            if (data.groups) {
                this.state.groups = data.groups;
                this.renderGroupsList();
            }
        } catch (error) {
            console.error('[KRONOS] Erreur chargement groupes:', error);
        }
    }

    // Afficher la modale de création de groupe
    showCreateGroupModal() {
        document.getElementById('create-group-modal').style.display = 'flex';
        document.getElementById('modal-overlay').style.display = 'block';
        document.getElementById('group-name').focus();
    }

    // Cacher la modale de création de groupe
    hideCreateGroupModal() {
        document.getElementById('create-group-modal').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
        this.resetCreateGroupForm();
    }

    // Réinitialiser le formulaire de création
    resetCreateGroupForm() {
        document.getElementById('group-name').value = '';
        document.getElementById('group-description').value = '';
        document.getElementById('group-type').value = 'private';
        document.getElementById('member-search').value = '';
        document.getElementById('selected-members').innerHTML = '';
        this.state.selectedMembers = [];
    }

    // ============================================
    // CRÉATION DE GROUPE
    // ============================================

    // Créer un nouveau groupe
    async createGroup() {
        const name = document.getElementById('group-name').value.trim();
        const description = document.getElementById('group-description').value.trim();
        const type = document.getElementById('group-type').value;
        const members = this.state.selectedMembers;

        // Validation
        if (!name) {
            this.showNotification('Erreur', 'Veuillez spécifier un nom pour le groupe', 'error');
            return;
        }

        if (name.length < 3) {
            this.showNotification('Erreur', 'Le nom doit contenir au moins 3 caractères', 'error');
            return;
        }

        if (members.length === 0) {
            this.showNotification('Erreur', 'Veuillez ajouter au moins un membre', 'error');
            return;
        }

        if (members.length < 2) {
            this.showNotification('Erreur', 'Un groupe doit contenir au moins 2 membres', 'error');
            return;
        }

        try {
            const response = await fetch('/api/groups/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    description: description,
                    type: type,
                    members: members.map(m => m.id)
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.showNotification('Succès', 'Groupe créé avec succès !', 'success');
                this.hideCreateGroupModal();
                
                // Ajouter le groupe à la liste
                if (data.group) {
                    this.state.groups.unshift(data.group);
                    this.renderGroupsList();
                    
                    // Rejoindre automatiquement le groupe
                    this.joinGroup(data.group.id);
                }
            } else {
                const error = await response.json();
                this.showNotification('Erreur', error.error || 'Erreur lors de la création', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur création groupe:', error);
            this.showNotification('Erreur', 'Erreur lors de la création', 'error');
        }
    }

    // ============================================
    // GESTION DES MEMBRES
    // ============================================

    // Rechercher des membres
    async searchMembers(query) {
        if (query.length < 2) {
            document.getElementById('member-suggestions').style.display = 'none';
            return;
        }

        try {
            const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            if (data.users) {
                this.renderMemberSuggestions(data.users);
            }
        } catch (error) {
            console.error('[KRONOS] Erreur recherche membres:', error);
        }
    }

    // Afficher les suggestions de membres
    renderMemberSuggestions(users) {
        const container = document.getElementById('member-suggestions');
        container.innerHTML = '';

        users.forEach(user => {
            // Ne pas afficher les membres déjà sélectionnés
            if (this.state.selectedMembers.find(m => m.id === user.id)) {
                return;
            }

            const suggestion = document.createElement('div');
            suggestion.className = 'member-suggestion';
            suggestion.innerHTML = `
                <img src="${user.avatar_filename || '/static/icons/default_avatar.svg'}" alt="${user.username}">
                <div class="member-suggestion-info">
                    <div class="member-suggestion-name">${user.display_name || user.username}</div>
                    <div class="member-suggestion-username">@${user.username}</div>
                </div>
            `;
            
            suggestion.addEventListener('click', () => {
                this.addMember(user);
            });

            container.appendChild(suggestion);
        });

        container.style.display = users.length > 0 ? 'block' : 'none';
    }

    // Ajouter un membre
    addMember(user) {
        this.state.selectedMembers.push(user);
        this.renderSelectedMembers();
        document.getElementById('member-search').value = '';
        document.getElementById('member-suggestions').style.display = 'none';
    }

    // Retirer un membre
    removeMember(userId) {
        this.state.selectedMembers = this.state.selectedMembers.filter(m => m.id !== userId);
        this.renderSelectedMembers();
    }

    // Afficher les membres sélectionnés
    renderSelectedMembers() {
        const container = document.getElementById('selected-members');
        container.innerHTML = '';

        this.state.selectedMembers.forEach(member => {
            const element = document.createElement('div');
            element.className = 'selected-member';
            element.innerHTML = `
                <span>${member.display_name || member.username}</span>
                <button class="selected-member-remove" onclick="groupManager.removeMember('${member.id}')">&times;</button>
            `;
            container.appendChild(element);
        });
    }

    // ============================================
    // MESSAGERIE DE GROUPE
    // ============================================

    // Rejoindre un groupe
    joinGroup(groupId) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('join_group', { group_id: groupId });
        }
        this.loadGroupMessages(groupId);
    }

    // Charger les messages d'un groupe
    async loadGroupMessages(groupId) {
        try {
            const response = await fetch(`/api/groups/${groupId}/messages`);
            const data = await response.json();
            
            if (data.messages) {
                this.state.messages[groupId] = data.messages.reverse();
                this.renderMessages(groupId);
            }
        } catch (error) {
            console.error('[KRONOS] Erreur chargement messages:', error);
        }
    }

    // Envoyer un message
    sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (!content || !this.state.currentGroup) {
            return;
        }

        const messageData = {
            group_target_id: this.state.currentGroup.id,
            content: content,
            client_id: this.generateClientId()
        };

        if (this.socket && this.socket.connected) {
            this.socket.emit('send_message', messageData);
        }

        input.value = '';
        input.style.height = 'auto';
    }

    // Gérer les nouveaux messages de groupe
    handleNewGroupMessage(data) {
        console.log('[KRONOS] Nouveau message de groupe:', data);

        // Si on est dans le groupe, ajouter le message
        if (this.state.currentGroup?.id === data.group_id) {
            this.addMessageToGroup(data.group_id, data.message);
        } else {
            // Mettre à jour le compteur de messages non lus
            this.updateGroupUnreadCount(data.group_id, data.message);
        }
    }

    // Ajouter un message à un groupe
    addMessageToGroup(groupId, message) {
        if (!this.state.messages[groupId]) {
            this.state.messages[groupId] = [];
        }

        this.state.messages[groupId].unshift(message);
        this.renderMessages(groupId);
        this.scrollToBottom();
    }

    // Afficher les messages
    renderMessages(groupId) {
        const container = document.getElementById('messages-list');
        const messages = this.state.messages[groupId] || [];

        container.innerHTML = messages.map(message => this.renderMessage(message)).join('');
    }

    // Rendre un message
    renderMessage(message) {
        const isSystem = message.message_type === 'system';
        const time = new Date(message.created_at).toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        if (isSystem) {
            return `
                <div class="system-message">
                    <div class="system-message-content">${message.content}</div>
                    <div class="system-message-time">${time}</div>
                </div>
            `;
        }

        return `
            <div class="group-message">
                <img src="${message.avatar_filename || '/static/icons/default_avatar.svg'}" 
                     alt="${message.username}" 
                     class="group-message-avatar">
                <div class="group-message-content">
                    <div class="group-message-header">
                        <span class="group-message-author">${message.display_name || message.username}</span>
                        <span class="group-message-time">${time}</span>
                    </div>
                    <div class="group-message-text">${this.formatMessageContent(message.content)}</div>
                    ${this.renderAttachments(message.attachments)}
                </div>
            </div>
        `;
    }

    // Formater le contenu d'un message
    formatMessageContent(content) {
        // Gestion du markdown de base
        content = content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');

        // Gestion des liens
        content = content.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );

        return content;
    }

    // Rendre les pièces jointes
    renderAttachments(attachments) {
        if (!attachments || attachments.length === 0) {
            return '';
        }

        return attachments.map(attachment => this.renderAttachment(attachment)).join('');
    }

    // Rendre une pièce jointe
    renderAttachment(attachment) {
        const { type, filename, url, thumbnail_url } = attachment;

        switch (type) {
            case 'image':
                return `
                    <div class="attachment">
                        <div class="image-preview">
                            <img src="${url}" alt="${filename}" loading="lazy">
                        </div>
                    </div>
                `;

            case 'video':
                return `
                    <div class="attachment">
                        <div class="video-preview">
                            <video src="${url}" preload="metadata"></video>
                            <div class="video-preview-overlay" onclick="groupManager.playVideo(this)">
                                <button class="video-play-button">
                                    <svg viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                `;

            case 'audio':
                return `
                    <div class="attachment">
                        <div class="audio-preview">
                            <audio controls src="${url}"></audio>
                        </div>
                    </div>
                `;

            default:
                return `
                    <div class="attachment">
                        <div class="file-preview">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <polyline points="10 9 9 9 8 9"/>
                            </svg>
                            <span>${filename}</span>
                            <button class="download-btn" onclick="window.open('${url}', '_blank')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
        }
    }

    // ============================================
    // GESTION DES ÉVÉNEMENTS SOCKET
    // ============================================

    // Gérer l'ajout d'un groupe
    handleGroupAdded(data) {
        console.log('[KRONOS] Groupe ajouté:', data.group);

        if (data.group) {
            // Ajouter le groupe à la liste
            this.state.groups.unshift(data.group);
            this.renderGroupsList();

            // Notifier l'utilisateur
            this.showNotification('Nouveau groupe', `Vous avez été ajouté au groupe "${data.group.name}"`, 'info');

            // Si on a un message de bienvenue, l'ajouter
            if (data.group.welcome_message && this.state.currentGroup?.id === data.group.id) {
                this.addMessageToGroup(data.group.id, data.group.welcome_message);
            }
        }
    }

    // Gérer la suppression d'un groupe
    handleGroupDeleted(data) {
        console.log('[KRONOS] Groupe supprimé:', data);

        // Retirer le groupe de la liste
        this.state.groups = this.state.groups.filter(g => g.id !== data.group_id);
        this.renderGroupsList();

        // Si on était dans le groupe supprimé, fermer la conversation
        if (this.state.currentGroup?.id === data.group_id) {
            this.state.currentGroup = null;
            document.getElementById('messages-list').innerHTML = '';
            document.getElementById('channel-name').textContent = 'Sélectionnez une conversation';
        }

        // Afficher une notification
        this.showNotification('Groupe supprimé', data.message, 'info');
    }

    // ============================================
    // UTILITAIRES
    // ============================================

    // Générer un ID client pour l'UI optimiste
    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Faire défiler vers le bas
    scrollToBottom() {
        const container = document.getElementById('messages-container');
        container.scrollTop = container.scrollHeight;
    }

    // Afficher une notification
    showNotification(title, message, type = 'info') {
        console.log(`[KRONOS] Notification: ${title} - ${message}`);
        // Implémenter le système de notification selon l'interface existante
    }

    // Mettre à jour le compteur de messages non lus
    updateGroupUnreadCount(groupId, message) {
        const group = this.state.groups.find(g => g.id === groupId);
        if (group) {
            group.unread_count = (group.unread_count || 0) + 1;
            group.last_message = message;
            this.renderGroupsList();
        }
    }

    // Lire une vidéo
    playVideo(overlay) {
        const video = overlay.previousElementSibling;
        const button = overlay.querySelector('.video-play-button');
        
        if (video.paused) {
            video.play();
            overlay.style.display = 'none';
        } else {
            video.pause();
            overlay.style.display = 'flex';
        }
    }

    // Cacher toutes les modales
    hideAllModals() {
        document.getElementById('create-group-modal').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
    }
}

// Initialisation du gestionnaire de groupes
const groupManager = new KRONOSGroupManager();

// Fonctions globales pour les onclick
function showCreateGroupModal() {
    groupManager.showCreateGroupModal();
}

function hideCreateGroupModal() {
    groupManager.hideCreateGroupModal();
}

function createGroup() {
    groupManager.createGroup();
}
```

# PYTHON BACKEND

```python
# ============================================
# BACKEND PYTHON - SYSTÈME DE GROUPES KRONOS
# ============================================

from flask import Flask, request, jsonify, render_template
from flask_login import login_required, current_user
from flask_socketio import SocketIO, emit, join_room, leave_room
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import OperationalError, IntegrityError
import uuid
import json
from datetime import datetime, timezone

# Importation des modèles
from models import User, Group, GroupMember, Message, OnlinePresence
from extensions import db, socketio

# ============================================
# MODÈLES DE DONNÉES (déjà définis dans models.py)
# ============================================

class Group(db.Model):
    __tablename__ = 'groups'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    avatar_filename = db.Column(db.String(255), nullable=True)
    
    # Créateur et administration
    creator_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False, index=True)
    
    # Paramètres du groupe
    is_private = db.Column(db.Boolean, default=False, nullable=False)
    max_members = db.Column(db.Integer, default=50, nullable=False)
    
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_current_utc_time, onupdate=get_current_utc_time, nullable=False)
    
    # Relations
    creator = db.relationship('User', foreign_keys=[creator_id], backref='created_groups')
    members = db.relationship('GroupMember', back_populates='group', cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'avatar_filename': self.avatar_filename,
            'creator_id': self.creator_id,
            'is_private': self.is_private,
            'max_members': self.max_members,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'member_count': len(self.members) if self.members else 0
        }

class GroupMember(db.Model):
    __tablename__ = 'group_members'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = db.Column(db.String(36), db.ForeignKey('groups.id'), nullable=False, index=True)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False, index=True)
    
    # Rôle dans le groupe
    role = db.Column(db.String(20), default='member', nullable=False)  # admin, member
    
    # Statut
    joined_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    
    # Relations
    group = db.relationship('Group', back_populates='members')
    user = db.relationship('User', foreign_keys=[user_id], backref='group_memberships')
    
    def to_dict(self):
        return {
            'id': self.id,
            'group_id': self.group_id,
            'user_id': self.user_id,
            'role': self.role,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
            'is_active': self.is_active
        }

# ============================================
# ROUTES API POUR LES GROUPES
# ============================================

@app.route('/api/groups/create', methods=['POST'])
@login_required
def create_group():
    """Créer un nouveau groupe"""
    data = request.get_json(silent=True) or {}
    
    # Validation des données
    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    group_type = data.get('type', 'public')
    member_ids = data.get('members', [])
    
    # Validation
    if not name:
        return jsonify({'error': 'Le nom du groupe est requis'}), 400
    
    if len(name) < 3:
        return jsonify({'error': 'Le nom doit contenir au moins 3 caractères'}), 400
    
    if len(name) > 50:
        return jsonify({'error': 'Le nom doit contenir au maximum 50 caractères'}), 400
    
    if len(description) > 500:
        return jsonify({'error': 'La description ne doit pas dépasser 500 caractères'}), 400
    
    if group_type not in ['public', 'private']:
        return jsonify({'error': 'Type de groupe invalide (doit être public ou private)'}), 400
    
    if not isinstance(member_ids, list):
        return jsonify({'error': 'Les membres doivent être une liste'}), 400
    
    if len(member_ids) == 0:
        return jsonify({'error': 'Au moins un membre est requis'}), 400
    
    # Vérifier que tous les member_ids sont valides
    for i, member_id in enumerate(member_ids):
        if not isinstance(member_id, str) or not member_id.strip():
            return jsonify({'error': f'ID de membre invalide à l\'index {i}'}), 400
    
    try:
        # Créer le groupe
        group = Group(
            name=name,
            description=description,
            creator_id=current_user.id,
            is_private=(group_type == 'private'),
            max_members=50
        )
        db.session.add(group)
        db.session.commit()
        
        # Ajouter le créateur comme membre admin
        creator_member = GroupMember(
            group_id=group.id,
            user_id=current_user.id,
            role='admin'
        )
        db.session.add(creator_member)
        
        # Ajouter les autres membres
        for member_id in member_ids:
            if member_id != current_user.id:  # Éviter les doublons
                member = GroupMember(
                    group_id=group.id,
                    user_id=member_id,
                    role='member'
                )
                db.session.add(member)
        
        db.session.commit()
        
        # Récupérer les informations complètes du groupe
        group_with_members = Group.query.filter_by(id=group.id).first()
        group_dict = group_with_members.to_dict()
        
        # Ajouter les informations des membres
        members_info = []
        for member in group_with_members.members:
            user = User.query.filter_by(id=member.user_id).first()
            if user:
                members_info.append({
                    'id': user.id,
                    'username': user.username,
                    'display_name': user.display_name,
                    'role': member.role
                })
        
        group_dict['members'] = members_info
        
        # Envoyer un message de bienvenue dans le groupe
        welcome_message = Message(
            channel_id=group.id,
            user_id=current_user.id,
            content=f"🎉 Bienvenue dans le groupe **{group.name}** !\n\nCe groupe a été créé par {current_user.display_name or current_user.username}.",
            message_type='system'
        )
        db.session.add(welcome_message)
        db.session.commit()
        
        # Ajouter le message de bienvenue aux données du groupe
        group_dict['welcome_message'] = {
            'id': welcome_message.id,
            'content': welcome_message.content,
            'user_id': current_user.id,
            'username': current_user.username,
            'display_name': current_user.display_name,
            'message_type': 'system',
            'created_at': welcome_message.created_at.isoformat()
        }
        
        # Notifier les membres connectés
        for member_id in member_ids:
            presence = OnlinePresence.query.filter_by(user_id=member_id).first()
            if presence:
                socketio.emit('group_added', {
                    'group': group_dict,
                    'added_by': current_user.to_dict()
                }, room=presence.socket_id)
                
                # Notifier les membres connectés du nouveau groupe avec le message de bienvenue
                socketio.emit('new_group_message', {
                    'group_id': group.id,
                    'message': group_dict['welcome_message']
                }, room=presence.socket_id)
        
        return jsonify({
            'message': 'Groupe créé avec succès',
            'group': group_dict
        })
        
    except IntegrityError as e:
        db.session.rollback()
        error_msg = str(e)
        
        if 'UNIQUE constraint failed: groups.name' in error_msg:
            return jsonify({'error': 'Un groupe avec ce nom existe déjà'}), 400
        elif 'NOT NULL constraint failed' in error_msg:
            return jsonify({'error': 'Un champ requis est manquant'}), 400
        elif 'FOREIGN KEY constraint failed' in error_msg:
            return jsonify({'error': 'Un ou plusieurs membres sont invalides'}), 400
        else:
            return jsonify({'error': f'Erreur de base de données: {error_msg}'}), 500
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Erreur lors de la création: {str(e)}'}), 500

@app.route('/api/groups/<group_id>/join', methods=['POST'])
@login_required
def join_group(group_id):
    """Rejoindre un groupe"""
    group = Group.query.filter_by(id=group_id).first()
    if not group:
        return jsonify({'error': 'Groupe introuvable'}), 404
    
    if group.is_private:
        return jsonify({'error': 'Ce groupe est privé'}), 403
    
    # Vérifier si déjà membre
    existing_member = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id,
        is_active=True
    ).first()
    
    if existing_member:
        return jsonify({'error': 'Vous êtes déjà membre de ce groupe'}), 400
    
    try:
        # Ajouter comme membre
        member = GroupMember(
            group_id=group_id,
            user_id=current_user.id,
            role='member'
        )
        db.session.add(member)
        db.session.commit()
        
        # Notifier les autres membres
        socketio.emit('group_member_joined', {
            'group_id': group_id,
            'member': current_user.to_dict()
        }, room=str(group_id))
        
        return jsonify({'message': 'Vous avez rejoint le groupe'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/groups/<group_id>/leave', methods=['POST'])
@login_required
def leave_group(group_id):
    """Quitter un groupe"""
    group = Group.query.filter_by(id=group_id).first()
    if not group:
        return jsonify({'error': 'Groupe introuvable'}), 404
    
    member = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id,
        is_active=True
    ).first()
    
    if not member:
        return jsonify({'error': 'Vous n\'êtes pas membre de ce groupe'}), 400
    
    try:
        # Si l'utilisateur est le créateur, supprimer le groupe
        if group.creator_id == current_user.id:
            db.session.delete(group)
            message = f'Le groupe "{group.name}" a été supprimé'
            
            # Notifier tous les membres que le groupe est supprimé
            members = GroupMember.query.filter_by(group_id=group_id, is_active=True).all()
            for member in members:
                if member.user_id != current_user.id:
                    socketio.emit('group_deleted', {
                        'group_id': group_id,
                        'group_name': group.name,
                        'message': f'Le groupe "{group.name}" a été supprimé par son créateur'
                    }, room=f'user_{member.user_id}')
        else:
            member.is_active = False
            message = f'Vous avez quitté le groupe "{group.name}"'
        
        db.session.commit()
        
        return jsonify({'message': message})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/groups/<group_id>/messages', methods=['GET'])
@login_required
def get_group_messages(group_id):
    """Récupérer les messages d'un groupe"""
    # Vérifier que l'utilisateur est membre du groupe
    member = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id,
        is_active=True
    ).first()
    
    if not member:
        return jsonify({'error': 'Vous n\'êtes pas membre de ce groupe'}), 403
    
    try:
        # Récupérer les messages (limités aux 100 plus récents)
        messages = Message.query.filter_by(
            channel_id=group_id
        ).order_by(Message.created_at.desc()).limit(100).all()
        
        return jsonify({
            'messages': [message.to_dict() for message in reversed(messages)]
        })
        
    except Exception as e:
        return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/groups/list', methods=['GET'])
@login_required
def list_groups():
    """Lister les groupes de l'utilisateur"""
    try:
        # Récupérer les groupes où l'utilisateur est membre
        memberships = GroupMember.query.filter_by(
            user_id=current_user.id,
            is_active=True
        ).all()
        
        groups = []
        for membership in memberships:
            group = Group.query.filter_by(id=membership.group_id).first()
            if group:
                group_dict = group.to_dict()
                group_dict['user_role'] = membership.role
                groups.append(group_dict)
        
        return jsonify({'groups': groups})
        
    except Exception as e:
        return jsonify({'error': f'Erreur: {str(e)}'}), 500

@app.route('/api/users/search', methods=['GET'])
@login_required
def search_users():
    """Rechercher des utilisateurs pour les groupes"""
    query = request.args.get('q', '').strip()
    
    if len(query) < 2:
        return jsonify({'users': []})
    
    try:
        # Rechercher par username ou display_name
        users = User.query.filter(
            db.or_(
                User.username.ilike(f'%{query}%'),
                User.display_name.ilike(f'%{query}%')
            ),
            User.is_active == True
        ).limit(10).all()
        
        return jsonify({
            'users': [user.to_dict() for user in users]
        })
        
    except Exception as e:
        return jsonify({'error': f'Erreur: {str(e)}'}), 500

# ============================================
# ÉVÉNEMENTS SOCKET.IO POUR LES GROUPES
# ============================================

@socketio.on('join_group')
def handle_join_group(data):
    """Rejoindre une room de groupe"""
    if not current_user.is_authenticated:
        return
    
    group_id = data.get('group_id')
    if not group_id:
        return
    
    # Vérifier que l'utilisateur est membre du groupe
    member = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id,
        is_active=True
    ).first()
    
    if member:
        join_room(str(group_id))
        emit('group_joined', {'group_id': group_id})

@socketio.on('leave_group')
def handle_leave_group(data):
    """Quitter une room de groupe"""
    if not current_user.is_authenticated:
        return
    
    group_id = data.get('group_id')
    if group_id:
        leave_room(str(group_id))
        emit('group_left', {'group_id': group_id})

@socketio.on('send_message')
def handle_send_message(data):
    """Envoi d'un message (supporte les groupes)"""
    try:
        channel_id = data.get('channel_id')
        content = data.get('content', '').strip()
        group_target_id = data.get('group_target_id')
        
        if not content:
            return {'status': 'error', 'message': 'Données invalides'}
        
        # Support pour les groupes
        if not channel_id and group_target_id:
            group = db.session.get(Group, group_target_id)
            if not group:
                return {'status': 'error', 'message': 'Groupe non trouvé'}
            
            # Vérifier que l'utilisateur est membre du groupe
            member = GroupMember.query.filter_by(
                group_id=group_target_id, 
                user_id=current_user.id
            ).first()
            if not member:
                return {'status': 'error', 'message': 'Vous n\'êtes pas membre de ce groupe'}
            
            # Utiliser group_id comme channel_id
            channel_id = group_target_id
            is_group_message = True
        else:
            is_group_message = False
        
        # Vérifications des permissions
        if not current_user.is_active:
            return {'status': 'error', 'message': 'Votre compte est désactivé'}
        
        # Pour les groupes, vérifier les permissions spécifiques
        if is_group_message:
            member = GroupMember.query.filter_by(
                group_id=channel_id, 
                user_id=current_user.id
            ).first()
            if not member:
                return {'status': 'error', 'message': 'Vous n\'êtes pas membre de ce groupe'}
        
        # Créer le message
        message = Message(
            channel_id=channel_id,
            user_id=current_user.id,
            content=content,
            message_type='text'
        )
        db.session.add(message)
        db.session.commit()
        
        # Préparer les données du message
        message_data = message.to_dict()
        message_data.update({
            'username': current_user.username,
            'display_name': current_user.display_name,
            'avatar_filename': current_user.avatar_filename
        })
        
        # Émettre le message
        if is_group_message:
            # Message de groupe
            socketio.emit('new_group_message', {
                'group_id': channel_id,
                'message': message_data
            }, room=str(channel_id))
        else:
            # Message de canal normal
            socketio.emit('new_message', message_data, room=str(channel_id))
        
        return {'status': 'success', 'message_id': str(message.id)}
        
    except Exception as e:
        print(f"[ERROR] handle_send_message: {e}")
        return {'status': 'error', 'message': 'Erreur interne'}

# ============================================
# UTILITAIRES
# ============================================

def get_current_utc_time():
    """Retourne l'heure UTC actuelle"""
    return datetime.now(timezone.utc)

def normalize_datetime(dt):
    """Normalise un datetime en UTC timezone-aware"""
    if dt is None:
        return None
    
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    else:
        return dt.astimezone(timezone.utc)
```

Ce système complet comprend :

1. **HTML** : Interface avec modale de création, liste des groupes, zone de chat
2. **CSS** : Styles complets avec correction des bordures Lime pour les embeds et bouton Play fonctionnel
3. **JavaScript** : Logique frontend complète (Socket.IO, création, messagerie temps réel)
4. **Python Backend** : Routes API, modèles de données, événements Socket.IO

Le système gère :
- Création de groupes privés/publics
- Sélection des membres avec recherche
- Messagerie temps réel avec Socket.IO
- Gestion des pièces jointes (vidéo, audio, fichiers)
- Notifications et mises à jour en temps réel
- Permissions et rôles (admin/member)
