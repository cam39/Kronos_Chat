// ============================================
// UNIFICATION TOTALE - DESIGN ORIGINAL UNIQUEMENT
// ============================================

// Charger les membres du salon - VERSION ORIGINALE UNIQUEMENT
loadMembers: async function() {
    console.log('[KRONOS] loadMembers appelé - VERSION ORIGINALE');
    
    try {
        // Émettre l'événement Socket.IO pour récupérer les membres
        if (this.socket && this.state.isConnected) {
            this.socket.emit('get_members', { channel_id: this.state.currentChannel?.id });
            console.log('[KRONOS] Événement get_members émis via Socket.IO');
        } else {
            console.warn('[KRONOS] Socket non disponible, utilisation du fallback');
            this.renderMembersFallback();
        }
    } catch (error) {
        console.warn('[KRONOS] Erreur lors du chargement des membres:', error);
        this.renderMembersFallback();
    }
},

// Gérer la connexion d'un utilisateur - PUSH SERVEUR + RENDU ORIGINAL
handleUserOnline: function(data) {
    console.log('[KRONOS] REÇU user_connected (PUSH SERVEUR):', data);
    
    // PUSHER LA LISTE MISE À JOUR VIA LE SERVEUR
    this.loadMembers();
},

// Gérer la déconnexion d'un utilisateur - PUSH SERVEUR + RENDU ORIGINAL
handleUserOffline: function(data) {
    console.log('[KRONOS] REÇU user_disconnected (PUSH SERVEUR):', data);
    
    // PUSHER LA LISTE MISE À JOUR VIA LE SERVEUR
    this.loadMembers();
},

// Afficher les membres avec sections par statut - VERSION ORIGINALE UNIQUEMENT
renderMembersWithStatus: function(members) {
    const container = this.elements.membersList;
    if (!container) return;
    
    console.log('[KRONOS] renderMembersWithStatus VERSION ORIGINALE appelé avec', members?.length, 'membres');
    
    // Mettre à jour le compteur total
    const memberCount = document.getElementById('member-count');
    if (memberCount) {
        memberCount.textContent = members.length;
    }
    
    // Calculer les statistiques - Utiliser is_online boolean du backend
    const stats = {
        online: members.filter(m => m.is_online === true || m.online === true).length,
        away: members.filter(m => m.status === 'away').length,
        dnd: members.filter(m => m.status === 'dnd').length,
        offline: members.filter(m => !m.is_online && !m.online).length
    };
    
    // Afficher les stats
    this.updateMembersStats(stats);

    // Filtrer les membres par section - Utiliser is_online boolean
    // Un utilisateur shadowbanni n'apparaît dans la liste "En ligne" que s'il s'agit de lui-même
    const onlineMembers = members.filter(m => {
        const isSelf = m.id === this.state.user?.id;
        const isOnline = m.is_online === true || m.online === true;
        const isShadowbanned = m.is_shadowbanned;
        // Visible si en ligne ET (pas shadowbanni OU c'est soi-même)
        return isOnline && (!isShadowbanned || isSelf);
    });
    const awayMembers = members.filter(m => m.status === 'away');
    const dndMembers = members.filter(m => m.status === 'dnd');
    const offlineMembers = members.filter(m => !m.is_online && !m.online);
    
    // Trier chaque groupe par rôle puis par nom
    const roleOrder = { supreme: 0, admin: 1, moderator: 2, member: 3 };
    const sortMembers = (a, b) => {
        const roleDiff = (roleOrder[a.role] || 3) - (roleOrder[b.role] || 3);
        if (roleDiff !== 0) return roleDiff;
        return (a.display_name || a.username).localeCompare(b.display_name || b.username);
    };
    
    onlineMembers.sort(sortMembers);
    awayMembers.sort(sortMembers);
    dndMembers.sort(sortMembers);
    offlineMembers.sort(sortMembers);
    
    // Construire le HTML
    let html = '';
    
    // Section En ligne
    if (onlineMembers.length > 0) {
        html += this.buildMembersSection('En ligne', 'online', onlineMembers, true);
    }
    
    // Section Absent
    if (awayMembers.length > 0) {
        html += this.buildMembersSection('Absent', 'away', awayMembers, true);
    }
    
    // Section Ne pas déranger
    if (dndMembers.length > 0) {
        html += this.buildMembersSection('Ne pas déranger', 'dnd', dndMembers, true);
    }
    
    // Section Hors ligne
    if (offlineMembers.length > 0) {
        html += this.buildMembersSection('Hors ligne', 'offline', offlineMembers, false);
    }
    
    // Message si aucun membre
    if (members.length === 0) {
        html = `
            <div class="members-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>Aucun membre</p>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // Ajouter les écouteurs d'événements
    this.attachMembersListeners();
},

// Construire une section de membres - VERSION ORIGINALE
buildMembersSection: function(title, status, members, expanded) {
    const sectionId = `members-section-${status}`;
    
    return `
        <div class="members-section" data-status="${status}">
            <div class="members-section-header" data-section="${sectionId}">
                <span class="members-section-title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                    ${title}
                </span>
                <span class="members-section-count">${members.length}</span>
            </div>
            <div class="members-section-content ${expanded ? '' : 'collapsed'}" id="${sectionId}">
                ${members.map(member => this.buildMemberItem(member)).join('')}
            </div>
        </div>
    `;
},

// Construir un élément de membre - VERSION ORIGINALE
buildMemberItem: function(member) {
    const isCurrentUser = member.id === this.state.user?.id;
    // Utiliser is_online boolean du backend (plus fiable que status string)
    const isOnline = member.is_online === true || member.online === true;
    const isAway = member.status === 'away';
    const isDnd = member.status === 'dnd';
    
    // Déterminer la classe de statut
    let statusClass = 'offline';
    if (isOnline) statusClass = 'online';
    else if (isAway) statusClass = 'away';
    else if (isDnd) statusClass = 'dnd';
    
    // Obtenir le texte de statut
    let statusText = '';
    if (isOnline) statusText = 'En ligne';
    else if (isAway) statusText = 'Absent';
    else if (isDnd) statusText = 'Ne pas déranger';
    else if (member.last_seen) statusText = `Vu ${this.formatLastSeen(member.last_seen)}`;
    
    // Obtenir le libellé du rôle
    const roleLabels = {
        supreme: 'SUPREME',
        admin: 'ADMIN',
        moderator: 'MOD',
        member: ''
    };
    
    const roleLabel = roleLabels[member.role] || '';
    
    return `
        <div class="member-item ${isCurrentUser ? 'active' : ''}" data-user-id="${member.id}" data-username="${this.escapeHtml(member.username)}" data-is-online="${isOnline}">
            <div class="member-avatar-container">
                <img src="${member.avatar || '/static/icons/default_avatar.svg'}" 
                     alt="" 
                     class="member-avatar"
                     onerror="this.src='/static/icons/default_avatar.svg'">
                <span class="member-status-indicator ${statusClass}"></span>
            </div>
            <div class="member-info">
                <div class="member-name-row">
                    <span class="member-name">${this.escapeHtml(member.display_name || member.username)}</span>
                    ${roleLabel ? `<span class="member-role-badge ${member.role}">${roleLabel}</span>` : ''}
                </div>
                <div class="member-meta">
                    <span class="member-username">@${this.escapeHtml(member.username)}</span>
                    ${!isOnline ? `<span class="member-last-seen">${statusText}</span>` : ''}
                </div>
            </div>
            <div class="member-item-actions">
                ${!isCurrentUser ? `
                    <button class="member-action-btn" title="Voir le profil" data-action="profile" data-user-id="${member.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
},

// Mettre à jour les statistiques des membres - VERSION ORIGINALE
updateMembersStats: function(stats) {
    const statsContainer = document.getElementById('members-stats');
    if (!statsContainer) return;
    
    // Afficher le conteneur de stats
    statsContainer.style.display = 'flex';
    
    // Mettre à jour les compteurs
    const onlineEl = document.getElementById('stat-online');
    const awayEl = document.getElementById('stat-away');
    const dndEl = document.getElementById('stat-dnd');
    const offlineEl = document.getElementById('stat-offline');
    
    if (onlineEl) onlineEl.textContent = stats.online;
    if (awayEl) awayEl.textContent = stats.away;
    if (dndEl) dndEl.textContent = stats.dnd;
    if (offlineEl) offlineEl.textContent = stats.offline;
},
