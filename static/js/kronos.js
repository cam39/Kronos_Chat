/**
 * KRONOS - Système de Communication Souverain
 * Application Principale JavaScript
 * Version stabilisée avec tous les bugs corrigés
 */

// ============================================
// HELPERS MUSTACHE PERSONNALISÉS
// ============================================
const MustacheHelpers = {
    if_eq: function(a, b, options) {
        return (a === b) ? options.fn(this) : options.inverse(this);
    },
    formatDate: function(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
};

// ============================================
// ÉTAT GLOBAL
// ============================================
const KRONOS = {
    state: {
        user: null,
        currentChannel: null,
        channels: {},
        messages: {},
        members: {},
        bannedUsers: [],
        shadowbannedUsers: [],
        onlineUsers: new Set(),
        typingUsers: new Map(),
        replyTo: null,
        isConnected: false,
        panicUrl: '/api/panic/config',
        panicHotkey: 'Control+Space',
        editingMessageId: null,
        currentMembersTab: 'members',
        // Pour l'actualisation en temps réel du profil
        profileOverlayUserId: null,
        // Nouveaux états pour les fonctionnalités avancées
        attachments: [],  // Fichiers à uploader
        pendingFiles: [], // Fichiers reçus en temps réel en attente d'affichage
        pagination: {
            hasMore: true,
            loading: false,
            beforeId: null
        },
        pins: {},
        dm: {
            conversations: [],
            current: null
        },
        drafts: {}, // Stockage des brouillons par channel_id
        pendingMessages: {}, // Suivi des messages en cours d'envoi par canal
        notifications: {
            sound: true,
            desktop: true,
            mentions: true,
            shortcut: 'Alt+N',
            volume: 0.5
        },
    },
    
    socket: null,
    elements: {},
    config: {
        messageLoadCount: 50,
        typingDebounce: 3000,
        reconnectDelay: 2000,
        maxReconnectAttempts: 5
    },
    
    applyThemePreference: function() {
        let t = document.body.getAttribute('data-theme') || 'dark';
        if (t && (t.startsWith('"') || t.startsWith("'"))) {
            t = t.replace(/^['"]+|['"]+$/g, '');
        }
        if (t === 'system') {
            document.body.setAttribute('data-theme-source', 'system');
            const mql = window.matchMedia('(prefers-color-scheme: dark)');
            const setScheme = () => {
                document.body.setAttribute('data-theme', mql.matches ? 'dark' : 'light');
            };
            setScheme();
            if (mql.addEventListener) {
                mql.addEventListener('change', setScheme);
            } else if (mql.addListener) {
                mql.addListener(setScheme);
            }
        }
    },
    
    // Initialisation
    init: async function() {
        console.log('[KRONOS] === DÉBUT INITIALISATION ===');
        
        try {
            this.applyThemePreference();
            // Récupérer les éléments DOM immédiatement
            this.cacheElements();
            console.log('[KRONOS] Éléments DOM mis en cache');
            
            // Fermer tous les panneaux au démarrage
            this.closeAllPanels();
            
            // Charger la config du Panic Mode
            await this.loadPanicConfig();
            
            // Vérifier l'authentification
            const authStatus = await this.checkAuth();
            
            if (authStatus.authenticated) {
                this.state.user = authStatus.user;
                console.log('[KRONOS] Utilisateur connecté:', this.state.user.username, 'Rôle:', this.state.user.role);
                if (authStatus.user && authStatus.user.mute_until) {
                    const ts = Date.parse(authStatus.user.mute_until);
                    if (!Number.isNaN(ts)) {
                        const epochSec = Math.floor(ts / 1000);
                        this.setMuteUntil(epochSec);
                    }
                }
                
                // Ajouter l'utilisateur courant aux utilisateurs en ligne
                if (this.state.user && this.state.user.id) {
                    this.state.onlineUsers.add(this.state.user.id);
                }
                
                this.showApp();
                await this.initSocket();
                await this.loadChannels();
                 await this.loadDMConversations();
                
                // Configurer les écouteurs APRÈS avoir vérifié l'authentification
                this.setupEventListeners();
                
                // Charger les membres IMMÉDIATEMENT après l'initialisation
                this.loadMembers();
                
                // Configurer un intervalle pour vérifier la présence des utilisateurs
                this.presenceInterval = setInterval(() => {
                    this.refreshPresence();
                }, 30000);  // Toutes les 30 secondes
                
                console.log('[KRONOS] === INITIALISATION TERMINÉE ===');

                // Sync avec le SW pour les notifications non lues
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.addEventListener('message', (event) => {
                        if (event.data.type === 'UNREAD_LIST') {
                            this.state.unreadNotifications = event.data.notifications || [];
                            console.log('[KRONOS] Sync notifications non lues:', this.state.unreadNotifications.length);
                        }
                    });

                    if (navigator.serviceWorker.controller) {
                        navigator.serviceWorker.controller.postMessage({ type: 'GET_UNREAD' });
                    }
                }
            } else {
                this.hideLoadingOverlay();
                window.location.href = '/login';
                return;
            }
            
            this.hideLoadingOverlay();
            
        } catch (error) {
            this.hideLoadingOverlay();
            this.updateDebugStatus('error', 'Erreur d’initialisation');
        }
    },
    
    
    
    bindPinsUI: function() {
        this.elements.pinsBtn?.addEventListener('click', () => this.openPinsPanel());
        this.elements.closePins?.addEventListener('click', () => this.closePinsPanel());
    },
    
    // Mettre en cache les éléments DOM avec vérification de sécurité
    cacheElements: function() {
        // Fonction helper sécurisée pour récupérer un élément
        const getEl = (id) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`[KRONOS] Élément DOM non trouvé: #${id}`);
            }
            return el;
        };
        
        this.elements = {
            appContainer: getEl('app-container'),
            messagesContainer: getEl('messages-container'),
            chatViewport: getEl('chat-viewport'),
            dockChannels: getEl('dock-channels'),
            membersList: getEl('members-list'),
            filesList: getEl('files-list'),
            
            // Header
            connectionStatus: getEl('connection-status'),
            connectionText: getEl('connection-text'),
            currentChannelDisplay: getEl('current-channel-display'),
            channelNameDisplay: getEl('channel-name-display'),
            userAvatar: getEl('user-avatar'),
            userName: getEl('user-name'),
            userRoleBadge: getEl('user-role-badge'),
            
            // Status bar
            statusBar: getEl('status-bar'),
            statusText: getEl('status-text'),
            
            // Debug status bar
            debugStatus: getEl('debug-status'),
            statusMessage: getEl('status-message'),
            
            // Inputs
            messageInput: getEl('message-input'),
            fileInput: getEl('file-input'),
            
            // Boutons - avec vérification de sécurité
            sendBtn: getEl('send-btn'),
            attachBtn: getEl('attach-btn'),
            panicBtn: getEl('panic-btn'),
            settingsBtn: getEl('settings-btn'),
            membersBtn: getEl('members-btn'),
            filesBtn: getEl('files-btn'),
            pinsBtn: getEl('pins-btn'),
            notifBtn: getEl('notif-btn'),
            replyCancel: getEl('reply-cancel'),
            cancelEditBtn: getEl('cancel-edit-btn'),
            
            // Indicateur utilisateur (remplace profileBtn qui n'existe pas)
            userIndicator: getEl('user-indicator'),
            
            // Reply preview
            replyPreview: getEl('reply-preview'),
            
            // Mentions
            mentionList: getEl('mention-list'),
            
            // Typing
            typingIndicator: getEl('typing-indicator'),
            
            // Panels
            membersPanel: getEl('members-panel'),
            filesPanel: getEl('files-panel'),
            pinsPanel: getEl('pins-panel'),
            profilePanel: getEl('profile-panel'),
            settingsModal: getEl('settings-modal'),
            adminModal: getEl('admin-modal'),
            modalOverlay: getEl('modal-overlay'),
            contextMenu: getEl('context-menu'),
            
            // Members panel tabs
            membersTabs: getEl('members-tabs'),
            membersListContainer: getEl('members-list-container'),
            bannedListContainer: getEl('banned-list-container'),
            membersSearchContainer: getEl('members-search-container'),
            membersStats: getEl('members-stats'),
            countMembers: getEl('count-members'),
            countBanned: getEl('count-banned'),
            
            // Panel close buttons
            closeMembers: getEl('close-members'),
            closeFiles: getEl('close-files'),
            closePins: getEl('close-pins'),
            closeProfile: getEl('close-profile'),
            pinsList: getEl('pins-list'),
            
            userIndicator: getEl('user-indicator'),
            privatePanel: getEl('private-messaging-panel'),
            privateConversationsList: getEl('private-conversations-list'),
            privateMessagesContainer: getEl('private-messages-container'),
            privateMessageInput: getEl('private-message-input'),
            privateSendBtn: getEl('private-send-btn'),
            privateCancelEditBtn: getEl('private-cancel-edit-btn'),
            privateAttachBtn: getEl('private-attach-btn'),
            privateFileInput: getEl('private-file-input'),
            privateFilesBtn: getEl('private-files-btn'),
            privateUnreadBadge: getEl('private-unread-badge'),
            privateChatAvatar: getEl('private-chat-avatar'),
            privateChatUsername: getEl('private-chat-username'),
            privateChatStatus: getEl('private-chat-status'),
            closePrivateChat: getEl('close-private-chat'),
            leavePrivateChat: getEl('leave-private-chat'),
            
            // Main menu
            mainMenuBtn: getEl('main-menu-btn'),
            mainMenuOverlay: getEl('main-menu-overlay'),
            closeMainMenu: getEl('close-main-menu')
        };
        
        if (this.state && this.state.muteUntil) {
            this.ensureMuteBanner();
            this.updateMuteUI();
        }
        
        console.log('[KRONOS] Éléments clés vérifiés');
    },
    
    // Charger la configuration du Panic Mode
    loadPanicConfig: async function() {
        try {
            const response = await fetch('/api/panic/config');
            if (!response.ok) return;
            const data = await response.json();
            this.state.panicUrl = data.panic_url;
            this.state.panicHotkey = data.panic_hotkey || 'Control+Space';
            console.log('[KRONOS] Config Panic:', this.state.panicHotkey);
        } catch (error) {
            console.warn('[KRONOS] Impossible de charger la config Panic:', error);
        }
    },

    // Basculer le menu principal
    toggleMainMenu: function(show = null) {
        if (!this.elements.mainMenuOverlay || !this.elements.mainMenuBtn) return;
        
        const isActive = show !== null ? !show : this.elements.mainMenuOverlay.classList.contains('active');
        
        if (!isActive) {
            this.elements.mainMenuOverlay.classList.add('active');
            this.elements.mainMenuBtn.classList.add('active');
            // Fermer les autres panneaux si nécessaire
            this.closeAllPanels();
        } else {
            this.elements.mainMenuOverlay.classList.remove('active');
            this.elements.mainMenuBtn.classList.remove('active');
        }
    },

    // ============================================
    // GESTION DES NOTIFICATIONS ET MENTIONS
    // ============================================
    setupNotificationListeners: function() {
        // Cache local pour les notifications non lues
        this.state.unreadNotifications = [];
        this.notificationDebounceTimer = null;

        // Bouton de notification
        if (this.elements.notifBtn) {
            this.elements.notifBtn.addEventListener('click', () => this.toggleNotifications());
            this.updateNotificationButton();
        }

        // Main menu toggle (Version améliorée avec transitions)
        if (this.elements.mainMenuBtn) {
            this.elements.mainMenuBtn.addEventListener('click', () => this.toggleMainMenu());
        }
        if (this.elements.closeMainMenu) {
            this.elements.closeMainMenu.addEventListener('click', () => this.toggleMainMenu(false));
        }
        if (this.elements.mainMenuOverlay) {
            this.elements.mainMenuOverlay.addEventListener('click', (e) => {
                if (e.target === this.elements.mainMenuOverlay) {
                    this.toggleMainMenu(false);
                }
            });
        }

        // Raccourci clavier dynamique
        document.addEventListener('keydown', (e) => {
            const shortcut = this.state.notifications.shortcut || 'Alt+N';
            const parts = shortcut.toLowerCase().split('+');
            const key = parts[parts.length - 1];
            const hasAlt = parts.includes('alt');
            const hasCtrl = parts.includes('ctrl') || parts.includes('control');
            const hasShift = parts.includes('shift');

            if (e.key.toLowerCase() === key && 
                e.altKey === hasAlt && 
                e.ctrlKey === hasCtrl && 
                e.shiftKey === hasShift) {
                e.preventDefault();
                this.toggleNotifications();
            }
        });

        // Input pour mentions
        if (this.elements.messageInput) {
            this.elements.messageInput.addEventListener('input', (e) => this.handleInput(e));
            this.elements.messageInput.addEventListener('keydown', (e) => this.handleInputKeydown(e));
        }
        
        // Demander la permission pour les notifications bureau au démarrage si activé
        this.checkNotificationPermission();

        // NOUVEAU : Forcer la demande de permission dès la première interaction (clic ou touche)
        // car les navigateurs bloquent les demandes automatiques sans geste utilisateur.
        const triggerPermission = () => {
            if ("Notification" in window && Notification.permission === "default") {
                Notification.requestPermission().then(permission => {
                    if (permission === "granted") {
                        console.log('[KRONOS] Notifications activées par l\'utilisateur');
                        this.registerServiceWorker();
                        const toast = document.querySelector('.notification-request-toast');
                        if (toast) toast.remove();
                    }
                });
            }
            // Retirer les écouteurs une fois activés
            document.removeEventListener('click', triggerPermission);
            document.removeEventListener('keydown', triggerPermission);
        };
        document.addEventListener('click', triggerPermission);
        document.addEventListener('keydown', triggerPermission);
    },

    checkNotificationPermission: function() {
        if (!("Notification" in window)) {
            console.log('[KRONOS] Les notifications desktop ne sont pas supportées.');
            return;
        }

        // Diagnostic technique approfondi
        const isSecure = window.isSecureContext;
        const hasSW = 'serviceWorker' in navigator;
        const currentPermission = Notification.permission;

        console.log('[KRONOS-DIAGNOSTIC]', {
            isSecureContext: isSecure,
            serviceWorkerSupported: hasSW,
            notificationPermission: currentPermission,
            userAgent: navigator.userAgent
        });

        // TENTATIVE DE DÉBLOCAGE PAR SERVICE WORKER
        // Si le navigateur bloque l'API Notification standard, le SW peut parfois
        // forcer l'enregistrement d'un abonnement Push qui réveille la permission.
        this.registerServiceWorker();

        if (currentPermission === "default") {
            // Affichage non-intrusif après un court délai pour ne pas bloquer le chargement
            setTimeout(() => this.showNotificationRequestUI(), 1000);
        } else if (currentPermission === "denied") {
            console.warn('[KRONOS] Notifications bloquées par l\'utilisateur ou le navigateur.');
            
            // Si bloqué, on tente une approche "silencieuse" via SW si possible
            if (hasSW && isSecure) {
                navigator.serviceWorker.ready.then(registration => {
                    // On vérifie si un abonnement existe déjà (cas d'un blocage partiel)
                    registration.pushManager.getSubscription().then(sub => {
                        if (sub) console.log('[KRONOS] Abonnement Push existant malgré le blocage local');
                    });
                });
            }
        }
    },

    registerServiceWorker: function() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/static/sw.js').then(reg => {
                console.log('[KRONOS] Service Worker enregistré:', reg.scope);
            }).catch(err => {
                console.error('[KRONOS] Échec de l\'enregistrement du SW:', err);
                this.retrySWRegistration(1);
            });
        }
    },

    retrySWRegistration: function(attempt) {
        if (attempt > 3) return;
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[KRONOS] Retry SW registration attempt ${attempt} in ${delay}ms`);
        setTimeout(() => this.registerServiceWorker(), delay);
    },

    showNotificationRequestUI: function() {
        if (document.querySelector('.notification-request-toast')) return;

        const toast = document.createElement('div');
        toast.className = 'notification-request-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--accent);
            color: #000;
            border-left: 6px solid #fff;
            padding: 20px 25px;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 12px;
            max-width: 350px;
            animation: slideInRight 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border: 1px solid rgba(255,255,255,0.2);
        `;
        
        toast.innerHTML = `
            <div style="font-weight: 800; font-size: 1.1em; text-transform: uppercase; letter-spacing: 1px;">🚀 Activer les Notifications</div>
            <div style="font-size: 0.95em; line-height: 1.4; font-weight: 500;">Ne manquez aucune mention (@) et restez informé en temps réel.</div>
            <div style="display: flex; gap: 12px; margin-top: 10px;">
                <button id="allow-notif-btn" style="background: #000; color: var(--accent); border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 800; font-size: 0.9em; flex: 1; transition: transform 0.2s;">ACTIVER MAINTENANT</button>
                <button id="deny-notif-btn" style="background: transparent; color: #000; border: 1px solid rgba(0,0,0,0.3); padding: 10px 15px; border-radius: 6px; cursor: pointer; font-size: 0.85em; font-weight: 600;">Plus tard</button>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        document.getElementById('allow-notif-btn').onclick = () => {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    this.showNotification('Notifications activées !', 'success');
                    this.registerServiceWorker();
                }
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            });
        };
        
        document.getElementById('deny-notif-btn').onclick = () => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        };
    },

    toggleNotifications: function() {
        this.state.notifications.sound = !this.state.notifications.sound;
        // On lie le son et le desktop pour simplifier (Mute global)
        const isMuted = !this.state.notifications.sound;
        
        this.updateNotificationButton();
        
        const status = isMuted ? "désactivées" : "activées";
        this.showNotification(`Notifications ${status}`, isMuted ? 'warning' : 'success');
        
        if (!isMuted) {
            this.playSound();
        }
    },

    updateNotificationButton: function() {
        if (!this.elements.notifBtn) return;
        
        const isMuted = !this.state.notifications.sound;
        if (isMuted) {
            this.elements.notifBtn.classList.add('muted');
            this.elements.notifBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    <path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path>
                    <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
            `;
        } else {
            this.elements.notifBtn.classList.remove('muted');
            this.elements.notifBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
            `;
        }
    },

    playSound: function() {
        if (!this.state.notifications.sound) return;
        
        // Son synthétisé simple (bip doux)
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(500, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.1);
                
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.start();
                osc.stop(ctx.currentTime + 0.1);
            }
        } catch (e) {
            console.error("Audio error", e);
        }
    },

    notifyUser: function(message) {
        if (!message || message.author?.id === this.state.user?.id) return;

        // Détection des mentions
        const isMentioned = message.content && this.state.user && 
                           (message.content.includes(`@${this.state.user.username}`) || 
                            message.content.includes('@everyone'));

        if (!isMentioned || !this.state.notifications.mentions) return;

        // Cache local des notifications non lues
        this.state.unreadNotifications.push({
            id: message.id,
            author: message.author?.username || 'Inconnu',
            content: message.content,
            timestamp: Date.now(),
            channel_id: message.channel_id
        });

        // Debounce pour éviter le spam sonore/visuel immédiat
        if (this.notificationDebounceTimer) clearTimeout(this.notificationDebounceTimer);
        this.notificationDebounceTimer = setTimeout(() => {
            this.processNotifications(message);
        }, 300);
    },

    processNotifications: function(lastMessage) {
        // Son de notification
        if (this.state.notifications.sound) {
            this.playSound();
        }

        // Notification Desktop ou Fallback
        const canUseDesktop = "Notification" in window && Notification.permission === "granted" && this.state.notifications.desktop;

        if (canUseDesktop) {
            this.sendDesktopNotification(lastMessage);
        } else {
            // Fallback: Notification in-app si bloqué ou non supporté
            this.showNotification(`Mention de ${lastMessage.author?.username}: ${lastMessage.content.substring(0, 50)}...`, 'info');
        }

        // Effet visuel
        document.body.classList.add('flash-mention');
        setTimeout(() => document.body.classList.remove('flash-mention'), 500);
    },

    sendDesktopNotification: function(message) {
        // Envoi au Service Worker pour gestion en arrière-plan et batching
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'MENTION',
                title: `Mention de ${message.author?.username || "Quelqu'un"}`,
                body: message.content,
                author: message.author?.username,
                channel_id: message.channel_id,
                url: window.location.href
            });
        } else {
            // Fallback direct si SW non prêt
            try {
                const n = new Notification(`Mention de ${message.author?.username}`, {
                    body: message.content,
                    icon: '/static/icons/favicon.svg',
                    tag: 'mention-' + message.channel_id
                });
                n.onclick = () => {
                    window.focus();
                    n.close();
                };
            } catch (e) {
                console.warn('[KRONOS] Erreur lors de l\'envoi de la notification directe:', e);
            }
        }
    },

    // Gestion des mentions
    handleInput: function(e) {
        const input = e.target;
        const value = input.value;
        const cursor = input.selectionStart;
        
        // Détecter @ avant le curseur
        const textBeforeCursor = value.substring(0, cursor);
        const lastAt = textBeforeCursor.lastIndexOf('@');
        
        if (lastAt !== -1) {
            // Vérifier les conditions:
            // 1. Soit au début du message (lastAt === 0)
            // 2. Soit précédé d'un espace (textBeforeCursor[lastAt - 1] === ' ')
            const isAtStart = lastAt === 0;
            const isPrecededBySpace = !isAtStart && textBeforeCursor[lastAt - 1] === ' ';

            if (!isAtStart && !isPrecededBySpace) {
                this.hideMentionList();
                return;
            }

            // Vérifier s'il y a un espace après le @ (pour annuler)
            const query = textBeforeCursor.substring(lastAt + 1);
            if (query.includes(' ')) {
                this.hideMentionList();
                return;
            }
            
            this.showMentionList(query, lastAt);
        } else {
            this.hideMentionList();
        }
    },

    handleInputKeydown: function(e) {
        if (!this.elements.mentionList || this.elements.mentionList.style.display === 'none') return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.navigateMentionList(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.navigateMentionList(-1);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            this.selectCurrentMention();
        } else if (e.key === 'Escape') {
            this.hideMentionList();
        }
    },

    showMentionList: function(query, atIndex) {
        if (!this.elements.mentionList) return;
        
        // Filtrer les utilisateurs (Online + Members du channel)
        const users = [];
        const seenIds = new Set();
        
        // Helper pour ajouter
        const addUser = (u) => {
            if (u && u.id && !seenIds.has(u.id) && u.id !== this.state.user.id) {
                if (u.username.toLowerCase().includes(query.toLowerCase())) {
                    users.push(u);
                    seenIds.add(u.id);
                }
            }
        };

        // 1. Members du channel courant
        if (this.state.members[this.state.currentChannel?.id]) {
            this.state.members[this.state.currentChannel.id].forEach(addUser);
        }
        
        // 2. Online users (fallback si pas dans members)
        if (this.state.onlineUsers) {
             this.state.onlineUsers.forEach(userId => {
                 if (!seenIds.has(userId)) {
                    // Essayer de trouver l'user dans allUsersMap ou créer un stub
                    let user = this.state.allUsersMap ? this.state.allUsersMap[userId] : null;
                    if (user) addUser(user);
                 }
             });
        }
        
        if (users.length === 0) {
            this.hideMentionList();
            return;
        }
        
        // Rendu
        this.elements.mentionList.innerHTML = '';
        users.forEach((user, index) => {
            const div = document.createElement('div');
            div.className = 'mention-item';
            if (index === 0) div.classList.add('active');
            div.innerHTML = `
                <img src="${user.avatar || '/static/icons/default_avatar.svg'}" class="mention-avatar">
                <span class="mention-username">${this.escapeHtml(user.username)}</span>
            `;
            div.addEventListener('click', () => this.insertMention(user, atIndex));
            this.elements.mentionList.appendChild(div);
        });
        
        this.elements.mentionList.style.display = 'flex';
        this.state.mentionAtIndex = atIndex; // Stocker la position du @
    },

    hideMentionList: function() {
        if (this.elements.mentionList) {
            this.elements.mentionList.style.display = 'none';
        }
    },

    navigateMentionList: function(direction) {
        const items = this.elements.mentionList.querySelectorAll('.mention-item');
        let activeIdx = Array.from(items).findIndex(el => el.classList.contains('active'));
        
        if (activeIdx !== -1) {
            items[activeIdx].classList.remove('active');
        }
        
        activeIdx += direction;
        if (activeIdx < 0) activeIdx = items.length - 1;
        if (activeIdx >= items.length) activeIdx = 0;
        
        items[activeIdx].classList.add('active');
        items[activeIdx].scrollIntoView({ block: 'nearest' });
    },

    selectCurrentMention: function() {
        const activeItem = this.elements.mentionList.querySelector('.mention-item.active');
        if (activeItem) {
            activeItem.click();
        }
    },

    insertMention: function(user, atIndex) {
        const input = this.elements.messageInput;
        const text = input.value;
        const before = text.substring(0, atIndex);
        const after = text.substring(input.selectionStart); // Reste du texte après curseur
        
        const mention = `@${user.username} `;
        input.value = before + mention + after;
        
        input.focus();
        input.setSelectionRange(atIndex + mention.length, atIndex + mention.length);
        
        this.hideMentionList();
    },
    
    
    // Vérifier l'authentification
    checkAuth: async function() {
        try {
            const response = await fetch('/api/user/profile');
            if (response.ok) {
                const data = await response.json();
                return { authenticated: true, user: data.user };
            }
            if (response.status === 401) {
                const data = await response.json();
                if (data.authenticated === false) {
                    return { authenticated: false };
                }
            }
            return { authenticated: false };
        } catch (error) {
            return { authenticated: false };
        }
    },
    
    // Afficher l'application principale
    showApp: function() {
        if (this.elements.appContainer) {
            this.elements.appContainer.style.display = 'flex';
        }
        this.updateUserIndicator();
        this.adjustChatHeight();
        window.addEventListener('resize', () => this.adjustChatHeight());
    },
    
    hideLoadingOverlay: function() {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        overlay.classList.add('hidden');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 700);
    },
    
    // Ajuster la hauteur du viewport chat
    adjustChatHeight: function() {
        console.log('[KRONOS] Hauteur ajustée');
    },
    
    // Mettre à jour l'indicateur utilisateur
    updateUserIndicator: function() {
        const user = this.state.user;
        if (!user) return;
        
        if (this.elements.userAvatar) {
            this.elements.userAvatar.src = user.avatar || '/static/icons/default_avatar.svg';
        }
        if (this.elements.userName) {
            this.elements.userName.textContent = user.display_name || user.username;
        }
        
        if (this.elements.userRoleBadge) {
            if (user.role === 'supreme') {
                this.elements.userRoleBadge.textContent = 'S';
                this.elements.userRoleBadge.className = 'user-role-badge supreme';
            } else if (user.role === 'admin' || user.role === 'moderator') {
                this.elements.userRoleBadge.textContent = 'A';
                this.elements.userRoleBadge.className = 'user-role-badge';
            } else {
                this.elements.userRoleBadge.style.display = 'none';
            }
        }
    },
    
    // Mettre à jour la barre de statut de débogage
    updateDebugStatus: function(type, message) {
        if (!this.elements.debugStatus || !this.elements.statusMessage) {
            console.warn('[KRONOS] Éléments de debugStatus non trouvés');
            return;
        }
        
        this.elements.debugStatus.classList.remove('debug-info', 'debug-success', 'debug-warning', 'debug-error');
        this.elements.debugStatus.classList.add(`debug-${type}`);
        
        const timestamp = new Date().toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        this.elements.statusMessage.textContent = `[${timestamp}] ${message}`;
        
        console.log(`[DEBUG ${type.toUpperCase()}] ${message}`);
        
        if (type === 'info') {
            clearTimeout(this.debugTimeout);
            this.debugTimeout = setTimeout(() => {
                if (this.elements.debugStatus) {
                    this.elements.debugStatus.classList.remove('debug-info', 'debug-success', 'debug-warning', 'debug-error');
                }
            }, 5000);
        }
    },
    
    // Initialiser Socket.IO avec gestion d'erreurs améliorée
    initSocket: function() {
        return new Promise((resolve, reject) => {
            // Vérifier si Socket.IO est chargé
            if (typeof io === 'undefined') {
                console.error('[KRONOS] Socket.IO non chargé!');
                this.updateDebugStatus('error', 'Socket.IO non chargé');
                reject(new Error('Socket.IO non disponible'));
                return;
            }
            
            try {
                this.socket = io({
                    transports: ['polling', 'websocket'],
                    reconnection: true,
                    reconnectionDelay: this.config.reconnectDelay,
                    reconnectionAttempts: this.config.maxReconnectAttempts,
                    timeout: 10000
                });
                
                this.socket.on('connect', () => {
                    console.log('[KRONOS] Connecté au serveur, SID:', this.socket.id);
                    this.state.isConnected = true;
                    this.updateConnectionStatus(true);
                    this.updateDebugStatus('success', 'Connecté au serveur');
                    
                    if (this.state.currentChannel) {
                        this.socket.emit('join_channel', { channel_id: this.state.currentChannel.id });
                        this.loadMessages(this.state.currentChannel.id);
                    }
                    resolve();
                });
                
                this.socket.on('disconnect', (reason) => {
                    console.log('[KRONOS] Déconnecté:', reason);
                    this.state.isConnected = false;
                    this.updateConnectionStatus(false);
                    this.updateDebugStatus('error', `Déconnecté: ${reason}`);
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('[KRONOS] Erreur de connexion:', error.message);
                    this.updateConnectionStatus(false);
                    this.updateDebugStatus('error', 'Erreur de connexion au serveur');
                });
                
                this.socket.on('connect_timeout', () => {
                    console.warn('[KRONOS] Timeout de connexion');
                    this.updateDebugStatus('warning', 'Timeout de connexion');
                });
                
                // Événements de l'application - avec vérification de sécurité
                this.socket.on('new_message', (message) => {
                    try {
                        this.handleNewMessage(message);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleNewMessage:', e);
                    }
                });
                this.socket.on('channel_activity', (data) => {
                    try {
                        const ch = data && data.channel_id != null ? String(data.channel_id) : null;
                        if (!ch) return;
                        const current = this.state.currentChannel?.id != null ? String(this.state.currentChannel.id) : null;
                        if (current && ch === current) return;
                        if (!this.state.channelUnread) this.state.channelUnread = {};
                        this.state.channelUnread[ch] = (this.state.channelUnread[ch] || 0) + 1;
                        this.renderChannels();
                    } catch (e) {
                        console.error('[KRONOS] Erreur channel_activity:', e);
                    }
                });
                this.socket.on('dm_conversation_created', (data) => {
                    try {
                        this.handleDMConversationCreated(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleDMConversationCreated:', e);
                    }
                });
                this.socket.on('dm_conversation_updated', (data) => {
                    try {
                        this.handleDMConversationUpdated(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleDMConversationUpdated:', e);
                    }
                });
                
                this.socket.on('message_edited', (message) => {
                    try {
                        this.handleMessageEdited(message);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleMessageEdited:', e);
                    }
                });
                
                this.socket.on('message_deleted', (data) => {
                    try {
                        this.handleMessageDeleted(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleMessageDeleted:', e);
                    }
                });
                
                this.socket.on('reaction_updated', (data) => {
                    try {
                        this.handleReactionUpdated(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleReactionUpdated:', e);
                    }
                });
                
                this.socket.on('message_pinned', (data) => {
                    const ch = data.channel_id;
                    if (!this.state.pins[ch]) this.state.pins[ch] = new Set();
                    this.state.pins[ch].add(data.message_id);
                    if (this.state.currentChannel?.id === ch) {
                        const el = document.querySelector(`[data-message-id="${data.message_id}"]`);
                        if (el) {
                            el.querySelector('.action-btn-pin')?.style && (el.querySelector('.action-btn-pin').style.display = 'none');
                            el.querySelector('.action-btn-unpin')?.style && (el.querySelector('.action-btn-unpin').style.display = 'inline-flex');
                        }
                    }
                });
                
                this.socket.on('message_unpinned', (data) => {
                    const ch = data.channel_id;
                    this.state.pins[ch]?.delete(data.message_id);
                    if (this.state.currentChannel?.id === ch) {
                        const el = document.querySelector(`[data-message-id="${data.message_id}"]`);
                        if (el) {
                            el.querySelector('.action-btn-pin')?.style && (el.querySelector('.action-btn-pin').style.display = 'inline-flex');
                            el.querySelector('.action-btn-unpin')?.style && (el.querySelector('.action-btn-unpin').style.display = 'none');
                        }
                    }
                });
                
                this.socket.on('user_typing', (data) => {
                    try {
                        this.handleUserTyping(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleUserTyping:', e);
                    }
                });
                
                this.socket.on('user_connected', (user) => {
                    try {
                        this.handleUserConnected(user);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleUserConnected:', e);
                    }
                });
                
                this.socket.on('user_disconnected', (data) => {
                    try {
                        this.handleUserDisconnected(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleUserDisconnected:', e);
                    }
                });
                
                this.socket.on('joined_channel', (data) => {
                    try {
                        this.handleJoinedChannel(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleJoinedChannel:', e);
                    }
                });
                
                // =================================================================
                // ÉVÉNEMENT TEMPS RÉEL - HISTORIQUE DES FICHIERS
                // =================================================================
                this.socket.on('new_file_uploaded', (data) => {
                    try {
                        console.log('[KRONOS] Nouvel événement new_file_uploaded:', data);
                        this.handleNewFileUploaded(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleNewFileUploaded:', e);
                    }
                });
                
                this.socket.on('kicked', (data) => {
                    try {
                        this.handleKicked(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleKicked:', e);
                    }
                });
                
                // =================================================================
                // ÉVÉNEMENTS ADMIN - NOUVEAUX
                // =================================================================
                this.socket.on('auto_promoted', (data) => {
                    try {
                        this.handleAutoPromoted(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleAutoPromoted:', e);
                    }
                });
                
                this.socket.on('admin_action_complete', (data) => {
                    try {
                        this.handleAdminActionComplete(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleAdminActionComplete:', e);
                    }
                });
                
                this.socket.on('shadowbanned_message', (data) => {
                    try {
                        this.handleShadowbannedMessage(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleShadowbannedMessage:', e);
                    }
                });
                
                this.socket.on('banned', (data) => {
                    try {
                        this.handleBanned(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleBanned:', e);
                    }
                });
                
                this.socket.on('user_banned', (data) => {
                    try {
                        this.handleUserBanned(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleUserBanned:', e);
                    }
                });
                
                this.socket.on('user_unbanned_broadcast', (data) => {
                    try {
                        this.handleUserUnbanned(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleUserUnbanned:', e);
                    }
                });
                
                this.socket.on('role_change', (data) => {
                    try {
                        this.handleRoleChange(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleRoleChange:', e);
                    }
                });
                
                this.socket.on('members_list', (data) => {
                    try {
                        this.handleMembersList(data);
                    } catch (e) {
                        console.error('[KRONOS] Erreur handleMembersList:', e);
                    }
                });
                
                this.socket.on('anti_spam_warning', (data) => {
                    try {
                        const reason = data && data.reason ? data.reason : 'Anti-spam';
                        this.showNotification(`Message bloqué: ${reason}`, 'warning');
                    } catch (e) {
                        console.error('[KRONOS] Erreur anti_spam_warning:', e);
                    }
                });
                
                this.socket.on('anti_spam_muted', (data) => {
                    try {
                        const secs = (data && data.seconds) ? data.seconds : 10;
                        const muteUntil = (data && data.mute_until) ? data.mute_until : Math.floor(Date.now()/1000) + secs;
                        this.setMuteUntil(muteUntil);
                    } catch (e) {
                        console.error('[KRONOS] Erreur anti_spam_muted:', e);
                    }
                });
                
                this.socket.on('mute_state', (data) => {
                    try {
                        if (data && data.mute_until) {
                            this.setMuteUntil(data.mute_until);
                        } else {
                            this.setMuteUntil(0);
                        }
                    } catch (e) {
                        console.error('[KRONOS] Erreur mute_state:', e);
                    }
                });
                
                this.socket.on('error', (data) => {
                    try {
                        this.showNotification(data.message || 'Erreur du serveur', 'error');
                    } catch (e) {
                        console.error('[KRONOS] Erreur notification:', e);
                    }
                });
                
                
                
            } catch (error) {
                console.error('[KRONOS] Erreur lors de l\'initialisation Socket.IO:', error);
                reject(error);
            }
        });
    },
    
    // Mettre à jour le statut de connexion
    updateConnectionStatus: function(connected) {
        if (this.elements.connectionStatus) {
            if (connected) {
                this.elements.connectionStatus.classList.add('connected');
                if (this.elements.connectionText) this.elements.connectionText.textContent = 'Connecté';
            } else {
                this.elements.connectionStatus.classList.remove('connected');
                if (this.elements.connectionText) this.elements.connectionText.textContent = 'Déconnecté';
            }
        }
    },
    
    // Gestion du mute: compteur persistant au-dessus de la zone de texte
    setMuteUntil: function(muteUntilEpochSec) {
        if (!this.state) this.state = {};
        this.state.muteUntil = parseInt(muteUntilEpochSec, 10);
        this.ensureMuteBanner();
        this.updateMuteUI();
        if (this.state.muteTimerId) {
            clearInterval(this.state.muteTimerId);
        }
        this.state.muteTimerId = setInterval(() => this.updateMuteUI(), 1000);
    },
    ensureMuteBanner: function() {
        if (!this.elements) this.elements = {};
        if (!this.elements.messageInput) return;
        let banner = document.getElementById('mute-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'mute-banner';
            banner.style.padding = '6px 10px';
            banner.style.marginBottom = '6px';
            banner.style.border = '1px solid var(--warning, #ffaa00)';
            banner.style.background = 'rgba(170, 85, 0, 0.15)';
            banner.style.color = 'var(--text_primary, #d4d4d8)';
            banner.style.display = 'none';
            banner.style.borderRadius = '6px';
            banner.style.fontSize = '0.9rem';
            banner.innerHTML = `
                <span class="mute-text">Vous êtes muet. Temps restant: <span class="mute-countdown">--:--</span></span>
                <button class="mute-appeal-btn" style="float:right;background:none;border:1px solid var(--border,#3f3f46);color:inherit;padding:2px 6px;border-radius:4px;cursor:pointer;">Faire appel</button>
            `;
            const parent = this.elements.messageInput.parentElement;
            parent.insertBefore(banner, this.elements.messageInput);
            const btn = banner.querySelector('.mute-appeal-btn');
            btn.addEventListener('click', () => {
                try {
                    if (this.socket) this.socket.emit('antispam_appeal', { reason: 'Utilisateur conteste le mute' });
                    this.showNotification('Appel envoyé aux modérateurs', 'info');
                } catch (e) {
                    console.error('[KRONOS] Appeal emit error:', e);
                }
            });
            this.elements.muteBanner = banner;
        } else {
            this.elements.muteBanner = banner;
        }
    },
    updateMuteUI: function() {
        if (!this.state || !this.state.muteUntil) return;
        const remaining = this.state.muteUntil - Math.floor(Date.now() / 1000);
        const banner = this.elements && this.elements.muteBanner ? this.elements.muteBanner : document.getElementById('mute-banner');
        const input = this.elements ? this.elements.messageInput : null;
        const sendBtn = this.elements ? this.elements.sendBtn : null;
        const privateInput = this.elements ? this.elements.privateMessageInput : null;
        const privateSendBtn = this.elements ? this.elements.privateSendBtn : null;
        if (remaining > 0) {
            if (banner) banner.style.display = 'block';
            if (input) input.disabled = true;
            if (sendBtn) sendBtn.disabled = true;
            if (privateInput) privateInput.disabled = true;
            if (privateSendBtn) privateSendBtn.disabled = true;
            const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
            const ss = String(remaining % 60).padStart(2, '0');
            if (banner) {
                const cd = banner.querySelector('.mute-countdown');
                if (cd) cd.textContent = `${mm}:${ss}`;
            }
        } else {
            if (banner) banner.style.display = 'none';
            if (input) input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            if (privateInput) privateInput.disabled = false;
            if (privateSendBtn) privateSendBtn.disabled = false;
            if (this.state.muteTimerId) {
                clearInterval(this.state.muteTimerId);
                this.state.muteTimerId = null;
            }
            this.state.muteUntil = null;
            this.showNotification('Mute terminé', 'info');
        }
    },
    
    // Charger les salons
    loadChannels: async function() {
        try {
            const response = await fetch('/api/channels');
            if (!response.ok) {
                console.error('[KRONOS] Erreur HTTP:', response.status);
                this.updateDebugStatus('error', 'Erreur chargement salons');
                return;
            }
            const data = await response.json();
            
            console.log('[KRONOS] Salons chargés:', data.channels);
            this.state.channels = data.channels;
            if (!this.state.channelUnread) this.state.channelUnread = {};
            if (!this.state.channelMentionUnread) this.state.channelMentionUnread = {};
            this.renderChannels();
            
            // CORRECTION: Sélectionner le premier salon PUBLIC disponible
            // On exclut les catégories privées et on privilégie 'Général'
            const privateCategories = ['privé', 'private', 'dm', 'direct messages', 'messages privés'];
            const categories = Object.keys(data.channels).filter(c => 
                !privateCategories.includes(c.toLowerCase())
            );
            
            if (categories.length > 0) {
                // Chercher 'Général' ou 'General' en priorité
                let targetChannel = null;
                
                // 1. Chercher dans toutes les catégories publiques
                for (const cat of categories) {
                    const channels = data.channels[cat];
                    if (!channels || channels.length === 0) continue;
                    
                    const general = channels.find(c => c.name.toLowerCase() === 'général' || c.name.toLowerCase() === 'general');
                    if (general) {
                        targetChannel = general;
                        break;
                    }
                }
                
                // 2. Sinon, prendre le tout premier channel disponible
                if (!targetChannel) {
                     for (const cat of categories) {
                        if (data.channels[cat] && data.channels[cat].length > 0) {
                            targetChannel = data.channels[cat][0];
                            break;
                        }
                     }
                }
                
                if (targetChannel) {
                    console.log('[KRONOS] Sélection du salon par défaut:', targetChannel.name);
                    this.selectChannel(targetChannel);
                } else {
                    console.warn('[KRONOS] Aucun salon public trouvé par défaut');
                }
            } else {
                console.warn('[KRONOS] Aucune catégorie publique trouvée');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur lors du chargement des salons:', error);
            this.updateDebugStatus('error', 'Erreur connexion API');
        }
    },
    
    // Afficher les salons dans le dock
    renderChannels: function() {
        const container = this.elements.dockChannels;
        if (!container) return;
        
        container.innerHTML = '';
        
        let firstCategory = true;
        
        for (const [category, channels] of Object.entries(this.state.channels)) {
            // Ne pas afficher la catégorie "Privé" dans le dock
            if (category && category.toLowerCase() === 'privé') {
                continue;
            }
            if (!firstCategory) {
                const divider = document.createElement('div');
                divider.className = 'channel-divider';
                container.appendChild(divider);
            }
            firstCategory = false;
            
            const categoryLabel = document.createElement('span');
            categoryLabel.className = 'channel-category';
            categoryLabel.textContent = category;
            container.appendChild(categoryLabel);
            
            channels.forEach(channel => {
                const channelItem = document.createElement('div');
                channelItem.className = 'channel-item';
                channelItem.dataset.channelId = channel.id;
                channelItem.dataset.channelName = channel.name;
                const key = String(channel.id);
                const unread = (this.state.channelUnread && this.state.channelUnread[key]) ? this.state.channelUnread[key] : 0;
                const hasMention = this.state.channelMentionUnread && this.state.channelMentionUnread[key];
                channelItem.innerHTML = `
                    <span class="channel-hash">#</span>
                    <span class="channel-name">${this.escapeHtml(channel.name)}</span>
                    ${unread > 0 ? `<span class="channel-unread-badge ${hasMention ? 'mention' : ''}">${unread}</span>` : ''}
                `;
                
                channelItem.addEventListener('click', () => this.selectChannel(channel));
                container.appendChild(channelItem);
            });
        }
    },
    
    // Sélectionner un salon
    // =================================================================
    // GESTION DES BROUILLONS (PERSISTANTS)
    // =================================================================
    getDraftKey: function(channelId) {
        if (!this.state.user?.id || !channelId) return null;
        return `draft:${this.state.user.id}:${channelId}`;
    },

    saveDraft: function(channelId, content) {
        const key = this.getDraftKey(channelId);
        if (!key) return;
        if (content) {
            localStorage.setItem(key, content);
            this.state.drafts[channelId] = content;
        } else {
            localStorage.removeItem(key);
            delete this.state.drafts[channelId];
        }
    },

    loadDraft: function(channelId) {
        const key = this.getDraftKey(channelId);
        if (!key) return '';
        return localStorage.getItem(key) || this.state.drafts[channelId] || '';
    },

    selectChannel: function(channel) {
        console.log('[KRONOS] selectChannel:', channel.name);
        
        if (!channel || !channel.id) {
            console.error('[KRONOS] Données de salon invalides');
            return;
        }

        // Sauvegarder le brouillon du canal précédent
        if (this.state.currentChannel) {
            // VÉRIFICATION PENDING : Si un message est en cours d'envoi, 
            // on ne touche PAS au brouillon (qui contient le message en cours)
            const isPending = this.state.pendingMessages && this.state.pendingMessages[this.state.currentChannel.id];
            
            if (!isPending) {
                // Si on vient d'un DM
                if (this.state.dm.current && this.elements.privateMessageInput) {
                    this.saveDraft(this.state.currentChannel.id, this.elements.privateMessageInput.value);
                    // Fermer le panneau DM si ouvert
                    this.closePrivateConversation();
                }
                // Si on vient d'un salon public
                else if (this.elements.messageInput) {
                    this.saveDraft(this.state.currentChannel.id, this.elements.messageInput.value);
                }
            }
        }
        
        // Restaurer le brouillon ou vider
        if (this.elements.messageInput) {
            this.elements.messageInput.value = this.loadDraft(channel.id);
        }

        // Réinitialiser aussi les pièces jointes
        this.state.attachments = [];
        this.renderAttachmentPreview();
        
        // IMPORTANT : Réinitialiser le contexte DM pour éviter les conflits
        this.state.dm.current = null;
        this.closePrivateConversation();

        this.state.currentChannel = channel;
        // Remise à zéro des compteurs non-lus/mentions pour ce salon
        if (!this.state.channelUnread) this.state.channelUnread = {};
        if (!this.state.channelMentionUnread) this.state.channelMentionUnread = {};
        const key = String(channel.id);
        this.state.channelUnread[key] = 0;
        if (this.state.channelMentionUnread[key]) delete this.state.channelMentionUnread[key];
        this.renderChannels();
        this.state.replyTo = null;
        this.updateReplyPreview();
        
        // Mettre à jour l'affichage
        if (this.elements.dockChannels) {
            this.elements.dockChannels.querySelectorAll('.channel-item').forEach(item => {
                item.classList.toggle('active', item.dataset.channelId === channel.id);
            });
        }
        
        if (this.elements.channelNameDisplay) {
            this.elements.channelNameDisplay.textContent = channel.name;
        }
        
        // Rejoindre le salon
        if (this.state.isConnected && this.socket) {
                console.log('[KRONOS] Joining channel room:', channel.id);
                this.socket.emit('join_channel', { channel_id: channel.id });
            } else {
                console.warn('[KRONOS] Cannot join channel room: not connected');
            }
        
        // Charger les messages
        this.loadMessages(channel.id);
    },
    
    // Charger les messages d'un salon
    loadMessages: async function(channelId) {
        if (!channelId) channelId = this.state.currentChannel?.id;
        if (!channelId) {
            console.warn('[KRONOS] Pas de channel ID pour charger les messages');
            return;
        }

        // Vider les notifications non lues pour ce canal
        if (this.state.unreadNotifications && this.state.unreadNotifications.length > 0) {
            const initialCount = this.state.unreadNotifications.length;
            this.state.unreadNotifications = this.state.unreadNotifications.filter(n => n.channel_id !== channelId);
            if (this.state.unreadNotifications.length !== initialCount) {
                // Si on a vidé des notifs, on prévient le SW (optionnel ici si on veut tout vider d'un coup plus tard)
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                    // Pour simplifier, on vide tout le cache IndexedDB quand on lit un salon si on veut, 
                    // ou on implémente un CLEAR_BY_CHANNEL dans le SW.
                    // Pour l'instant on se contente de la sync locale.
                }
            }
        }
        
        console.log('[KRONOS] Chargement des messages pour:', channelId);
        
        try {
            const response = await fetch(`/api/messages/${channelId}`);
            if (!response.ok) {
                console.error('[KRONOS] Erreur lors du chargement des messages:', response.status);
                return;
            }
            const data = await response.json();
            
            console.log('[KRONOS] Messages chargés:', data.messages.length);
            
            // CORRECTION CRITIQUE: Préserver les messages optimistes (pending) lors du chargement
            const currentMessages = this.state.messages[channelId] || [];
            const pendingMessages = currentMessages.filter(m => m.pending);
            const serverIds = new Set(data.messages.map(m => m.id));
            const uniquePending = pendingMessages.filter(m => !serverIds.has(m.id));
            
            this.state.messages[channelId] = [...data.messages, ...uniquePending];
            
            try {
                const pinsResp = await fetch(`/api/channels/${channelId}/pins`);
                if (pinsResp.ok) {
                    const pinsData = await pinsResp.json();
                    const set = new Set((pinsData.pins || []).map(p => p.pin?.message_id).filter(Boolean));
                    this.state.pins[channelId] = set;
                }
            } catch (e) {}
            
            // Ne rendre que si c'est le canal public courant
            if (this.state.currentChannel && this.state.currentChannel.id === channelId && !this.state.dm.current) {
                this.renderMessages(this.state.messages[channelId]);
            }
            
            this.scrollToBottom();
        } catch (error) {
            console.error('[KRONOS] Erreur lors du chargement des messages:', error);
        }
    },
    
    // Afficher les messages
    renderMessages: function(messages) {
        const container = this.elements.messagesContainer;
        
        if (!container) {
            console.error('[KRONOS] Conteneur de messages non trouvé!');
            return;
        }
        
        container.innerHTML = '';
        
        console.log('[KRONOS] renderMessages appelé avec', messages ? messages.length : 0, 'messages');
        
        if (!messages || messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <h3>Aucun message</h3>
                    <p>Soyez le premier à écrire dans ce salon !</p>
                </div>
            `;
            return;
        }
        
        // Créer un fragment pour optimiser les performances
        const fragment = document.createDocumentFragment();
        
        messages.forEach((message, index) => {
            try {
                console.log('[KRONOS] Création de l\'élément', index, '- ID:', message.id);
                const element = this.createMessageElement(message);
                if (element) {
                    fragment.appendChild(element);
                }
            } catch (error) {
                console.error('[KRONOS] Erreur lors de la création de l\'élément de message:', error);
            }
        });
        
        container.appendChild(fragment);
        this.scrollToBottom();
    },
    
    // Créer un élément de message
    createMessageElement: function(message) {
        if (!message || !message.id) {
            console.error('[KRONOS] Données de message invalides');
            return null;
        }
        
        const templateEl = document.getElementById('message-template');
        const useTemplate = templateEl && templateEl.textContent.trim();
        
        // Déterminer si c'est un message système
        const isSystemMessage = message.type === 'system' || message.message_type === 'system';
        
        // Si pas de template ou message système, utiliser le fallback
        if (!useTemplate || isSystemMessage) {
            return this.createFallbackMessageElement(message);
        }
        
        // Préparer les données pour Mustache
        const renderData = {
            id: message.id,
            content: this.formatMessageContent(message.content),
            time: this.formatTime(message.created_at),
            is_edited: message.is_edited,
            is_system: isSystemMessage,
            // Utiliser les données les plus récentes pour l'auteur (rôle à jour)
            author: isSystemMessage ? null : (message.author ? (() => {
                const authorId = message.author.id || '';
                // Récupérer le rôle et le statut le plus récents depuis allUsersMap
                const latestUser = this.state.allUsersMap?.[authorId] || {};
                const currentRole = latestUser.role || message.author.role || 'member';
                const isBanned = this.state.bannedUsers?.some(u => u.id === authorId);
                
                return {
                    id: authorId,
                    username: message.author.username || '',
                    display_name: message.author.display_name || message.author.username || 'Inconnu',
                    avatar: message.author.avatar || '/static/icons/default_avatar.svg',
                    role: currentRole,
                    role_name: (function(r){switch(r){case 'supreme':return 'Admin Suprême';case 'admin':return 'Admin';case 'moderator':return 'Modérateur';default:return 'Membre';}})(currentRole),
                    has_special_role: currentRole !== 'member',
                    is_supreme: currentRole === 'supreme',
                    is_admin: currentRole === 'admin' || currentRole === 'moderator',
                    is_banned: isBanned
                };
            })() : null),
            can_edit: message.author?.id === this.state.user?.id || this.state.user?.is_admin,
            can_delete: message.author?.id === this.state.user?.id || this.state.user?.is_admin,
            reply_to: message.reply_to,
            has_attachments: message.attachments && message.attachments.length > 0,
            attachments: message.attachments?.map(att => ({
                id: att.id,
                url: att.url || `/api/files/${att.id}`,
                original_filename: att.original_filename || att.name || att.filename || 'Fichier',
                name: att.name || att.filename || att.original_filename || 'Fichier',
                filename: att.filename || att.name || att.original_filename || 'Fichier',
                type: att.type,
                size: att.size, // Garder la taille originale pour le template
                size_formatted: this.formatBytes(att.size || 0), // Version formatée pour l'affichage
                is_image: att.type === 'image',
                is_video: att.type === 'video',
                is_audio: att.type === 'audio',
                is_document: att.type === 'document',
                is_file: att.type === 'file'
            })),
            attachments_html: (message.attachments && message.attachments.length > 0) ? this.renderAttachmentsHtml(message.attachments) : ''
        };
        
        try {
            const template = templateEl.textContent.trim();
            const rendered = Mustache.render(template, renderData);
            const div = document.createElement('div');
            div.innerHTML = rendered;
            const element = div.firstElementChild;
            
            if (!element) {
                console.error('[KRONOS] Erreur lors de la création de l\'élément de message');
                return this.createFallbackMessageElement(message);
            }
            
            this.attachMessageListeners(element, message);
            return element;
        } catch (error) {
            console.error('[KRONOS] Erreur lors du rendu Mustache:', error);
            return this.createFallbackMessageElement(message);
        }
    },
    
    // Créer un élément de message de fallback
    createFallbackMessageElement: function(message) {
        const div = document.createElement('div');
        div.className = 'message';
        div.dataset.messageId = message.id;
        
        const isSystemMessage = message.type === 'system' || message.message_type === 'system';
        
        // Vérifier si l'auteur est banni
        const authorId = message.author?.id;
        const isAuthorBanned = authorId ? this.state.bannedUsers?.some(u => u.id === authorId) : false;
        if (isAuthorBanned) {
            div.classList.add('banned-author');
        }
        
        if (isSystemMessage) {
            div.className = 'message system-message';
            div.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author system">Système</span>
                        <span class="message-time">${this.formatTime(message.created_at)}</span>
                    </div>
                    <div class="message-body">${this.escapeHtml(message.content || '')}</div>
                </div>
            `;
        } else {
            const authorName = message.author?.display_name || message.author?.username || 'Inconnu';
            const authorAvatar = message.author?.avatar || '/static/icons/default_avatar.svg';
            const authorIdSafe = message.author?.id || '';
            const latestUser = this.state.allUsersMap?.[authorIdSafe] || message.author || {};
            const currentRole = latestUser.role || 'member';
            const roleLabel = (function(r){switch(r){case 'supreme':return 'Admin Suprême';case 'admin':return 'Admin';case 'moderator':return 'Modérateur';default:return 'Membre';}})(currentRole);
            const roleBadge = `<span class="role-badge ${currentRole}">${roleLabel}</span>`;
            const banIndicator = isAuthorBanned ? '<span class="banned-indicator">🚫 Banni</span>' : '';
            
            div.innerHTML = `
                <div class="message-gutter">
                    <img src="${authorAvatar}" alt="" class="message-avatar" onerror="this.src='/static/icons/default_avatar.svg'">
                </div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author ${isAuthorBanned ? 'banned' : ''}">${this.escapeHtml(authorName)} ${roleBadge}</span>
                        ${banIndicator}
                        <span class="message-time">${this.formatTime(message.created_at)}</span>
                    </div>
                    <div class="message-body">${this.escapeHtml(message.content || '')}</div>
                </div>
            `;
            
            // Ajouter les pièces jointes au message
            if (message.attachments && message.attachments.length > 0) {
                const attachmentsHtml = this.renderAttachmentsHtml(message.attachments);
                const contentDiv = div.querySelector('.message-content');
                if (contentDiv) {
                    contentDiv.insertAdjacentHTML('beforeend', attachmentsHtml);
                }
            }
        }
        
        this.attachMessageListeners(div, message);
        return div;
    },
    
    // Rendre les pièces jointes en HTML pour les messages
    renderAttachmentsHtml: function(attachments) {
        if (!attachments || attachments.length === 0) return '';
        
        let html = '<div class="message-attachments">';
        
        attachments.forEach(att => {
            const url = att.url || `/api/files/${att.id}`;
            const filename = att.original_filename || att.name || att.filename || 'Fichier';
            const fileSize = this.formatBytes(att.size || 0);
            
            if (att.type === 'image') {
                html += `
                    <div class="attachment image" data-file-id="${att.id}">
                        <div class="attachment-image-wrapper">
                            <img src="${url}" alt="${this.escapeHtml(filename)}" class="attachment-preview" loading="lazy" onclick="KRONOS.previewFile('${att.id}', 'image')">
                            <div class="attachment-overlay">
                                <button class="attachment-view-btn" onclick="KRONOS.previewFile('${att.id}', 'image')">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                    Aperçu
                                </button>
                                <a href="${url}" download="${this.escapeHtml(filename)}" class="attachment-download-btn" title="Télécharger">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </a>
                            </div>
                        </div>
                        <div class="attachment-filename">${this.escapeHtml(filename)}</div>
                    </div>
                `;
            } else if (att.type === 'video') {
                html += `
                    <div class="attachment video" data-file-id="${att.id}">
                        <div class="attachment-video-wrapper">
                            <video src="${url}" preload="metadata" class="attachment-preview" onclick="KRONOS.previewFile('${att.id}', 'video')"></video>
                            <div class="attachment-overlay">
                                <button class="attachment-view-btn" onclick="KRONOS.previewFile('${att.id}', 'video')">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polygon points="5 3 19 12 5 21 5 3"/>
                                    </svg>
                                    Lecture
                                </button>
                                <a href="${url}" download="${this.escapeHtml(filename)}" class="attachment-download-btn" title="Télécharger">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </a>
                            </div>
                        </div>
                        <div class="attachment-filename">${this.escapeHtml(filename)}</div>
                    </div>
                `;
            } else if (att.type === 'audio') {
                html += `
                    <div class="attachment audio" data-file-id="${att.id}">
                        <div class="audio-player">
                            <button class="play-btn" onclick="this.nextElementSibling.play(); this.style.display='none'; this.nextElementSibling.nextElementSibling.style.display='flex';">▶</button>
                            <audio src="${url}" preload="metadata"></audio>
                            <button class="play-btn active" style="display:none;" onclick="this.parentElement.querySelector('audio').pause(); this.parentElement.querySelector('.play-btn').style.display='flex'; this.style.display='none';">⏸</button>
                            <div class="audio-info">
                                <span class="filename">${this.escapeHtml(filename)}</span>
                                <span class="audio-meta">${fileSize}</span>
                            </div>
                            <a href="${url}" download="${this.escapeHtml(filename)}" class="audio-download" title="Télécharger">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </a>
                        </div>
                    </div>
                `;
            } else if (att.type === 'document') {
                html += `
                    <div class="attachment document" data-file-id="${att.id}" onclick="KRONOS.previewFile('${att.id}', 'document')">
                        <div class="document-preview">
                            <div class="document-icon">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                </svg>
                            </div>
                            <div class="document-info">
                                <span class="document-name">${this.escapeHtml(filename)}</span>
                                <span class="document-meta">${fileSize}</span>
                            </div>
                            <div class="document-actions">
                                <button class="document-action-btn" title="Ouvrir">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                        <polyline points="15 3 21 3 21 9"/>
                                        <line x1="10" y1="14" x2="21" y2="3"/>
                                    </svg>
                                </button>
                                <a href="${url}" download="${this.escapeHtml(filename)}" class="document-action-btn" title="Télécharger">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </a>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Fichier générique
                html += `
                    <div class="attachment file" data-file-id="${att.id}" onclick="KRONOS.previewFile('${att.id}', '${att.type || 'file'}')">
                        <div class="file-preview">
                            <div class="file-icon-wrapper">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                                    <polyline points="13 2 13 9 20 9"/>
                                </svg>
                            </div>
                            <div class="file-info">
                                <span class="file-name">${this.escapeHtml(filename)}</span>
                                <span class="file-meta">${fileSize}</span>
                            </div>
                            <div class="file-actions">
                                <a href="${url}" download="${this.escapeHtml(filename)}" class="file-action-btn" title="Télécharger">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </a>
                            </div>
                        </div>
                    </div>
                `;
            }
        });
        
        html += '</div>';
        return html;
    },
    
    // Ajouter les écouteurs d'événements aux messages
    attachMessageListeners: function(element, message) {
        if (!element || !message) return;
        
        // Nettoyer les anciens boutons d'actions pour éviter les doublons de listeners
        const oldActionsBar = element.querySelector('.message-actions-bar');
        if (oldActionsBar) oldActionsBar.remove();
        
        // Profil interactif - clic sur l'avatar
        const avatar = element.querySelector('.message-avatar');
        if (avatar) {
            avatar.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isSystemMessage = message.type === 'system' || message.message_type === 'system';
                if (isSystemMessage) {
                    console.log('[KRONOS] Message système - pas de profil à afficher');
                    return;
                }
                
                if (!message.author) {
                    this.showNotification('Impossible d\'afficher le profil', 'error');
                    return;
                }
                
                this.showUserProfile(message.author);
            });
        }
        
        // Profil interactif - clic sur le pseudo
        const authorEl = element.querySelector('.message-author');
        if (authorEl && !authorEl.classList.contains('system')) {
            authorEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isSystemMessage = message.type === 'system' || message.message_type === 'system';
                if (isSystemMessage) return;
                if (!message.author) {
                    this.showNotification('Impossible d\'afficher le profil', 'error');
                    return;
                }
                
                this.showUserProfile(message.author);
            });
        }
        
        // Actions du message
        const replyBtn = element.querySelector('.reply-btn');
        if (replyBtn) {
            replyBtn.addEventListener('click', () => this.startReply(message));
        }
        
        const editBtn = element.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => this.editMessage(message));
        }
        
        const deleteBtn = element.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteMessage(message.id));
        }
        
        // Réactions
        element.querySelectorAll('.reaction').forEach(btn => {
            btn.addEventListener('click', () => this.toggleReaction(btn));
        });
        
        const addReaction = element.querySelector('.add-reaction');
        if (addReaction) {
            addReaction.addEventListener('click', () => this.showEmojiPicker(addReaction));
        }
        
        // Pièces jointes
        element.querySelectorAll('.attachment').forEach(att => {
            att.addEventListener('click', () => this.openAttachment(att.dataset.fileId));
        });
        
        // Menu contextuel (clic droit)
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, message);
        });
        
        // Barre d'actions au survol (éditer/supprimer)
        const isSelf = message.author?.id === this.state.user?.id;
        const isAdmin = this.state.user?.role === 'admin' || this.state.user?.role === 'supreme';
        const canModify = isSelf || isAdmin;
        const canPin = isAdmin;
        
        if (canModify && !message.is_system) {
            // Créer la barre d'actions si elle n'existe pas
            let actionsBar = element.querySelector('.message-actions-bar');
            if (!actionsBar) {
                actionsBar = document.createElement('div');
                actionsBar.className = 'message-actions-bar';
                const isPinned = this.state.pins[this.state.currentChannel?.id || message.channel_id]?.has(message.id);
                actionsBar.innerHTML = `
                    <button class="action-btn-edit" title="Modifier">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn-delete" title="Supprimer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                    ${canPin ? `
                    <button class="action-btn-pin" title="Épingler" style="display:${isPinned ? 'none' : 'inline-flex'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 16 6 12 10 8 6"></polygon>
                            <line x1="12" y1="10" x2="12" y2="22"></line>
                        </svg>
                    </button>
                    <button class="action-btn-unpin" title="Désépingler" style="display:${isPinned ? 'inline-flex' : 'none'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 16 6 12 10 8 6"></polygon>
                            <line x1="12" y1="10" x2="12" y2="22"></line>
                            <line x1="4" y1="4" x2="20" y2="20"></line>
                        </svg>
                    </button>` : ''}
                `;
                element.appendChild(actionsBar);
                
                // Écouteurs pour les boutons
                actionsBar.querySelector('.action-btn-edit').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.editMessage(message);
                });
                
                actionsBar.querySelector('.action-btn-delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteMessage(message.id);
                });
                
                if (canPin) {
                    actionsBar.querySelector('.action-btn-pin')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.pinMessage(message.id);
                    });
                    actionsBar.querySelector('.action-btn-unpin')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.unpinMessage(message.id);
                    });
                }
            }
        }
    },
    
    pinMessage: async function(messageId) {
        try {
            const r = await fetch(`/api/messages/${messageId}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (!r.ok) return;
            const data = await r.json();
            const channelId = this.state.currentChannel?.id;
            if (!this.state.pins[channelId]) this.state.pins[channelId] = new Set();
            this.state.pins[channelId].add(messageId);
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            el?.querySelector('.action-btn-pin')?.style && (el.querySelector('.action-btn-pin').style.display = 'none');
            el?.querySelector('.action-btn-unpin')?.style && (el.querySelector('.action-btn-unpin').style.display = 'inline-flex');
        } catch (e) {}
    },
    
    unpinMessage: async function(messageId) {
        try {
            const r = await fetch(`/api/messages/${messageId}/pin`, { method: 'DELETE' });
            if (!r.ok) return;
            const channelId = this.state.currentChannel?.id;
            this.state.pins[channelId]?.delete(messageId);
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            el?.querySelector('.action-btn-pin')?.style && (el.querySelector('.action-btn-pin').style.display = 'inline-flex');
            el?.querySelector('.action-btn-unpin')?.style && (el.querySelector('.action-btn-unpin').style.display = 'none');
        } catch (e) {}
    },
    
    openPinsPanel: async function() {
        if (!this.elements.pinsPanel) return;
        this.elements.pinsPanel.classList.add('open');
        await this.loadPinsList();
    },
    
    closePinsPanel: function() {
        this.elements.pinsPanel?.classList.remove('open');
    },
    
    loadPinsList: async function() {
        const channelId = this.state.currentChannel?.id;
        if (!channelId || !this.elements.pinsList) return;
        this.elements.pinsList.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:12px;">Chargement...</div>`;
        try {
            const r = await fetch(`/api/channels/${channelId}/pins`);
            if (!r.ok) { this.elements.pinsList.innerHTML = ''; return; }
            const data = await r.json();
            const pins = data.pins || [];
            if (pins.length === 0) {
                this.elements.pinsList.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:12px;">Aucun message épinglé</div>`;
                return;
            }
            const html = pins.map(p => {
                const m = p.message || {};
                const author = (m.author && (m.author.display_name || m.author.username)) || 'Inconnu';
                const time = this.formatTime(m.created_at);
                const content = this.escapeHtml(m.content || '');
                return `<div class="pin-item" data-mid="${m.id || ''}">
                    <div class="pin-meta"><span>${author}</span><span>${time}</span></div>
                    <div class="pin-content">${content}</div>
                </div>`;
            }).join('');
            this.elements.pinsList.innerHTML = html;
            this.elements.pinsList.querySelectorAll('.pin-item').forEach(item => {
                item.addEventListener('click', () => {
                    const mid = item.getAttribute('data-mid');
                    const el = document.querySelector(`[data-message-id="${mid}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('highlight');
                        setTimeout(() => el.classList.remove('highlight'), 1200);
                    }
                });
            });
        } catch (e) {
            this.elements.pinsList.innerHTML = '';
        }
    },
    
    // Gérer un nouveau message
    handleNewMessage: function(message) {
        if (!message) return;
        
        console.log('[KRONOS] Nouveau message de:', message.author?.username, 'Channel:', message.channel_id);
        
        this.notifyUser(message);
        
        const chId = message.channel_id != null ? String(message.channel_id) : null;
        const currentChannelId = this.state.currentChannel?.id != null ? String(this.state.currentChannel.id) : null;
        const isForCurrentChannel = chId && currentChannelId && chId === currentChannelId;
        
        // Cas spécial : Auto-assignation du channel pour une nouvelle DM (SEULEMENT si le message vient de l'autre utilisateur)
        // On évite que n'importe quel message global ne s'approprie la DM courante
        if (this.state.dm.current && !this.state.dm.current.channel) {
            const isFromTarget = this.state.dm.current.other_user?.id === message.author?.id;
            const isMyMessage = message.author?.id === this.state.user?.id;
            
            if (isFromTarget || isMyMessage) {
                 this.state.dm.current.channel = { id: message.channel_id };
                 this.state.currentChannel = this.state.dm.current.channel;
                 if (this.socket && this.state.isConnected) {
                     this.socket.emit('join_channel', { channel_id: message.channel_id });
                 }
                 // Mise à jour de l'indicateur local pour la suite de la fonction
                 // (Note: currentChannelId variable locale n'est pas mise à jour, mais this.state.currentChannel l'est)
            }
        }

        const isMyMessage = message.author?.id === this.state.user?.id;

        if (!isForCurrentChannel) {
            const idx = this.state.dm.conversations.findIndex(c => {
                if (!c.channel || c.channel.id == null) return false;
                return String(c.channel.id) === chId;
            });
            if (idx !== -1) {
                this.state.dm.conversations[idx].last_message = message;
                if (!isMyMessage) {
                    this.state.dm.conversations[idx].unread_count = (this.state.dm.conversations[idx].unread_count || 0) + 1;
                    const mentionedIds = message.mentioned_user_ids || [];
                    let isMention = false;
                    if (this.state.user) {
                        if (Array.isArray(mentionedIds) && mentionedIds.includes(this.state.user.id)) {
                            isMention = true;
                        } else if (message.content && (message.content.includes(`@${this.state.user.username}`) || message.content.includes('@everyone'))) {
                            isMention = true;
                        }
                    }
                    if (isMention) {
                        this.state.dm.conversations[idx].has_mention_unread = true;
                    }
                }
                const conv = this.state.dm.conversations.splice(idx, 1)[0];
                this.state.dm.conversations.unshift(conv);
                this.renderDMConversations();
                this.updatePrivateUnreadBadge();
            } else if (!isMyMessage && chId) {
                if (!this.state.channelUnread) this.state.channelUnread = {};
                if (!this.state.channelMentionUnread) this.state.channelMentionUnread = {};
                const prev = this.state.channelUnread[chId] || 0;
                this.state.channelUnread[chId] = prev + 1;
                const mentionedIds = message.mentioned_user_ids || [];
                let isMention = false;
                if (this.state.user) {
                    if (Array.isArray(mentionedIds) && mentionedIds.includes(this.state.user.id)) {
                        isMention = true;
                    } else if (message.content && (message.content.includes(`@${this.state.user.username}`) || message.content.includes('@everyone'))) {
                        isMention = true;
                    }
                }
                if (isMention && chId) {
                    this.state.channelMentionUnread[chId] = true;
                }
                this.renderChannels();
            }
            return;
        }
        
        // À partir d'ici, le message EST pour le canal courant (Channel ou DM)
        
        // DÉDUPLICATION OPTIMISTIC UI
        // Vérifier si un message avec ce client_id existe déjà (en attente)
        if (message.client_id) {
            // Recherche dans les deux conteneurs (public et privé)
            const pendingMsgPublic = this.elements.messagesContainer?.querySelector(`[data-message-id="${message.client_id}"]`);
            const pendingMsgPrivate = this.elements.privateMessagesContainer?.querySelector(`[data-message-id="${message.client_id}"]`);
            
            const pendingMsg = pendingMsgPublic || pendingMsgPrivate;

            if (pendingMsg) {
                // Le message est déjà là (optimiste), on le met juste à jour
                pendingMsg.dataset.messageId = message.id;
                pendingMsg.classList.remove('message-pending');
                pendingMsg.classList.remove('private-message-sending'); // Nettoyage spécifique privé
                pendingMsg.classList.remove('message-sending'); // Nettoyage spécifique public
                pendingMsg.classList.remove('message-failed');
                
                // Retirer l'icône de statut
                const statusIcon = pendingMsg.querySelector('.status-icon');
                if (statusIcon) statusIcon.remove();
                
                // Mettre à jour le state
                if (this.state.messages[message.channel_id]) {
                    const idx = this.state.messages[message.channel_id].findIndex(m => m.client_id === message.client_id);
                    if (idx !== -1) {
                        this.state.messages[message.channel_id][idx] = message;
                    }
                }
                
                // CRITIQUE : Mettre à jour les listeners pour utiliser l'ID réel
                this.attachMessageListeners(pendingMsg, message);
                
                // On s'assure que le contenu est bien synchronisé (ex: URLs des fichiers finaux)
                // Si le message a des pièces jointes, on peut vouloir rafraîchir la zone de pièces jointes
                // Mais pour l'instantanéité, on garde le DOM actuel qui est "visuellement" correct
                return;
            }
        }
        
        // Supprimer le message temporaire s'il existe (fallback ancienne méthode sans client_id)
        // Note: On ne supprime plus aveuglément '.message-sending' car cela pourrait supprimer un message en cours d'un autre onglet
        // On ne le fait que si on n'a pas trouvé de match par client_id ci-dessus
        
        // Retirer le message s'il existe déjà par son ID serveur (doublon)
        const existingMsgPublic = this.elements.messagesContainer?.querySelector(`[data-message-id="${message.id}"]`);
        const existingMsgPrivate = this.elements.privateMessagesContainer?.querySelector(`[data-message-id="${message.id}"]`);
        
        if (existingMsgPublic) existingMsgPublic.remove();
        if (existingMsgPrivate) existingMsgPrivate.remove();
        
        // Mise à jour du state local
        if (this.state.messages[message.channel_id]) {
            const exists = this.state.messages[message.channel_id].find(m => m.id === message.id);
            if (!exists) {
                this.state.messages[message.channel_id].push(message);
            }
        } else {
            // Initialiser si vide
            this.state.messages[message.channel_id] = [message];
        }
        
        // AJOUT DYNAMIQUE AU DOM (SANS RECHARGEMENT COMPLET)
        if (this.state.dm.current && message.channel_id === this.state.dm.current.channel?.id) {
             // C'est un message privé
             const container = this.elements.privateMessagesContainer;
             if (container) {
                 // Supprimer l'état vide
                 const emptyState = container.querySelector('.private-empty-state');
                 if (emptyState) emptyState.remove();

                 // Créer l'élément manuellement comme dans renderPrivateMessages
                 const div = document.createElement('div');
                 div.className = 'private-message ' + (message.author?.id === this.state.user?.id ? 'mine' : 'theirs');
                 div.dataset.messageId = message.id;
                 const avatar = message.author?.avatar || '/static/icons/default_avatar.svg';
                 const name = message.author?.display_name || message.author?.username || '';
                 const time = this.formatTime(message.created_at);
                 
                 div.innerHTML = `
                    <img class="private-message-avatar" src="${avatar}" alt="">
                    <div class="private-message-content">
                        <div class="private-message-author">${this.escapeHtml(name)}</div>
                        <div class="private-message-bubble">${this.escapeHtml(message.content || '')}</div>
                        <div class="private-message-meta">
                            <span class="private-message-time">${time}</span>
                        </div>
                    </div>
                 `;
                 
                 // Actions DM: réutiliser la barre publique (message-actions-bar)
                 const canEdit = (message.author?.id === this.state.user?.id) || (this.state.user?.role === 'admin' || this.state.user?.role === 'supreme' || this.state.user?.is_admin);
                 if (canEdit) {
                     const bar = document.createElement('div');
                     bar.className = 'message-actions-bar';
                     bar.innerHTML = `
                         <button class="action-btn-edit" title="Modifier">
                             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                 <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                 <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                             </svg>
                         </button>
                         <button class="action-btn-delete" title="Supprimer">
                             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                 <polyline points="3 6 5 6 21 6"/>
                                 <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                             </svg>
                         </button>
                     `;
                     div.appendChild(bar);
                     bar.querySelector('.action-btn-edit')?.addEventListener('click', (e) => { e.stopPropagation(); this.editMessage(message); });
                     bar.querySelector('.action-btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); this.deleteMessage(message.id); });
                 }
                 
                 // Ajouter les pièces jointes
                 if (message.attachments && message.attachments.length > 0) {
                     const attachmentsHtml = this.renderAttachmentsHtml(message.attachments);
                     const contentDiv = div.querySelector('.private-message-content');
                     if (contentDiv) {
                         const bubble = contentDiv.querySelector('.private-message-bubble');
                         if (bubble) bubble.insertAdjacentHTML('afterend', attachmentsHtml);
                         else contentDiv.insertAdjacentHTML('beforeend', attachmentsHtml);
                     }
                 }

                 // Gestionnaire de clic avatar
                 const avatarEl = div.querySelector('.private-message-avatar');
                 if (avatarEl) {
                     avatarEl.addEventListener('click', (e) => {
                         e.preventDefault(); e.stopPropagation();
                         if (message.author) this.showUserProfile(message.author);
                     });
                 }
                 
                 container.appendChild(div);
                 container.scrollTop = container.scrollHeight;
             }
        } else {
            // C'est un message public
            const element = this.createMessageElement(message);
            if (!element) return;
            
            element.classList.add('message-new');
            const emptyState = this.elements.messagesContainer?.querySelector('.empty-state');
            if (emptyState) emptyState.remove();
            
            this.elements.messagesContainer?.appendChild(element);
            this.scrollToBottom();
        }
        
        // Mettre à jour la liste des conversations privées (dernière activité + tri)
        const idx = this.state.dm.conversations.findIndex(c => c.channel?.id === message.channel_id);
        if (idx !== -1) {
            this.state.dm.conversations[idx].last_message = message;
            const conv = this.state.dm.conversations.splice(idx, 1)[0];
            // Si on est dans ce DM, remettre le compteur à zéro
            if (this.state.dm.current && this.state.dm.current.channel?.id === message.channel_id) {
                conv.unread_count = 0;
            }
            this.state.dm.conversations.unshift(conv);
            this.renderDMConversations();
            this.updatePrivateUnreadBadge();
        }
        
        // ============================================
        // MISE À JOUR EN TEMPS RÉEL DU PANNEAU DE FICHIERS
        // ============================================
        // Si le nouveau message contient des pièces jointes, les ajouter au panneau de fichiers
        if (message.attachments && message.attachments.length > 0) {
            // Passer l'ID du canal pour filtrer correctement
            this.handleNewAttachments(message.attachments, message.author, message.channel_id);
            // Mettre à jour également les fichiers privés si c'est la conversation courante
            this.handleNewPrivateAttachments(message.attachments, message.channel_id);
        }
    },
    
    // Met à jour le badge d'inlus privés agrégé
    updatePrivateUnreadBadge: function() {
        const badge = this.elements.privateUnreadBadge;
        if (!badge) return;
        const total = (this.state.dm.conversations || []).reduce((sum, c) => sum + (c.unread_count || 0), 0);
        if (total > 0) {
            badge.textContent = String(total);
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    },
    
    // Quitter une conversation privée (fermeture immédiate + serveur)
    leavePrivateConversation: async function() {
        const channelId = this.state.dm.current?.channel?.id;
        if (!channelId) {
            this.closePrivateConversation();
            return;
        }
        
        // 1. Désinscription immédiate Socket (Critical Path)
        if (this.socket && this.state.isConnected) {
             this.socket.emit('leave_channel', { channel_id: channelId });
        }

        // 2. Mise à jour du store local (optimiste)
        this.state.dm.conversations = this.state.dm.conversations.filter(c => c.channel?.id !== channelId);
        
        // 3. Fermeture immédiate UI (Re-render forcé)
        this.closePrivateConversation();
        this.renderDMConversations();
        
        try {
            const resp = await fetch('/api/dm/leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: channelId })
            });
            
            if (resp.ok) {
                this.showNotification('Conversation quittée');
            } else if (resp.status !== 404) {
                console.warn('[KRONOS] Erreur serveur lors du départ (ignorée pour UX)');
            }
        } catch (e) {
            console.error('[KRONOS] leavePrivateConversation error:', e);
        } 
    },
    
    // Recharger la liste des conversations privées depuis le serveur
    refreshDMConversations: async function() {
        try {
            const resp = await fetch('/api/dm/conversations');
            if (!resp.ok) return;
            const data = await resp.json().catch(() => null);
            if (data && Array.isArray(data.conversations)) {
                this.state.dm.conversations = data.conversations;
                this.renderDMConversations();
            }
        } catch (e) {
            console.error('[KRONOS] refreshDMConversations error:', e);
        }
    },
    
    // =================================================================
    // GESTION DES ÉVÉNEMENTS TEMPS RÉEL - FICHIERS
    // =================================================================
    
    // Gérer l'événement new_file_uploaded (temps réel)
    handleNewFileUploaded: function(data) {
        console.log('[KRONOS] handleNewFileUploaded appelé avec:', data);
        
        const files = data?.files;
        if (!files || files.length === 0) {
            console.log('[KRONOS] Aucun fichier dans les données');
            return;
        }

        // Vérification CRITIQUE : Ne traiter que si c'est pour le canal courant
        if (data.channel_id && this.state.currentChannel?.id && data.channel_id !== this.state.currentChannel.id) {
            console.log(`[KRONOS] Ignoré: Fichier pour canal ${data.channel_id}, actuel: ${this.state.currentChannel.id}`);
            return;
        }
        
        // Identifier la liste cible (Publique ou Privée)
        let filesList = document.getElementById('files-list');
        const privateFilesList = document.getElementById('private-files-list');
        const privatePanel = document.getElementById('private-files-panel');
        
        // LOGIQUE STRICTE DE CIBLAGE DE LISTE
        // Si nous sommes dans un contexte DM (dm.current existe), 
        // les fichiers NE DOIVENT PAS aller dans la liste publique (files-list).
        if (this.state.dm.current) {
            // Contexte DM : on cible UNIQUEMENT la liste privée
            if (privatePanel && privatePanel.classList.contains('open') && privateFilesList) {
                filesList = privateFilesList;
            } else {
                // Si le panneau privé n'est pas ouvert, on ne doit PAS utiliser files-list (public)
                // On met filesList à null pour empêcher l'ajout au DOM public
                filesList = null;
            }
        } else {
            // Contexte Public : on utilise files-list par défaut
            // Mais on vérifie quand même que c'est bien le bon canal
            // (déjà fait par le check channel_id plus haut, mais double sécurité)
        }
        
        // Toujours stocker les fichiers en attente
        files.forEach(file => {
            // Attacher l'ID du canal pour filtrage ultérieur
            if (!file.channel_id) file.channel_id = data.channel_id;
            
            const exists = this.state.pendingFiles.some(f => f.id === file.id);
            if (!exists) {
                this.state.pendingFiles.unshift(file);
            }
        });
        
        if (!filesList) {
            return;
        }
        
        // Vérifier si le panneau est encore en chargement
        const loadingState = filesList.querySelector('.files-loading');
        if (loadingState) {
            console.log('[KRONOS] Panneau encore en chargement - fichiers gardés en attente');
            return;
        }
        
        console.log('[KRONOS] Mise à jour temps réel de l\'historique des fichiers avec', files.length, 'nouveaux fichiers');
        
        // Récupérer les IDs des fichiers déjà présents dans le DOM
        const existingFileIds = new Set();
        filesList.querySelectorAll('.file-item').forEach(item => {
            existingFileIds.add(item.dataset.fileId);
        });
        
        // Filtrer les fichiers qui ne sont pas déjà dans le DOM
        const filesToAdd = files.filter(file => !existingFileIds.has(file.id));
        
        if (filesToAdd.length === 0) {
            console.log('[KRONOS] Tous les fichiers sont déjà présents dans le panneau');
            return;
        }
        
        // Retirer l'état vide s'il existe
        const emptyState = filesList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
        
        // Vérifier si un conteneur grid existe, sinon le créer
        let filesGrid = filesList.querySelector('.files-grid');
        if (!filesGrid) {
            filesList.innerHTML = '<div class="files-grid"></div>';
            filesGrid = filesList.querySelector('.files-grid');
        }
        
        // Créer les nouveaux éléments de fichiers
        const fragment = document.createDocumentFragment();
        
        filesToAdd.forEach((file, index) => {
            const fileData = {
                ...file,
                size_formatted: file.size_formatted || this.formatBytes(file.size || 0)
            };
            
            const fileItemHtml = this.renderFileItem(fileData);
            if (fileItemHtml) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = fileItemHtml;
                const fileItem = tempDiv.firstElementChild;
                
                if (fileItem) {
                    // Ajouter l'animation d'entrée
                    fileItem.style.opacity = '0';
                    fileItem.style.transform = 'translateY(-10px)';
                    fileItem.style.transition = `all 0.3s ease ${index * 0.05}s`;
                    fragment.insertBefore(fileItem, fragment.firstChild);
                }
            }
        });
        
        // Insérer tous les nouveaux éléments au début du grid
        filesGrid.insertBefore(fragment, filesGrid.firstChild);
        
        // Appliquer l'animation
        requestAnimationFrame(() => {
            filesGrid.querySelectorAll('.file-item').forEach((item, index) => {
                if (index < filesToAdd.length) {
                    item.style.opacity = '1';
                    item.style.transform = 'translateY(0)';
                }
            });
        });
        
        // Mettre à jour le compteur de fichiers
        this.updateFilesCount();
    },
    
    // Gérer les nouvelles pièces jointes en temps réel
    handleNewAttachments: function(attachments, author, channelId) {
        // Vérification CRITIQUE : Ne traiter que si c'est pour le canal courant
        if (channelId && this.state.currentChannel?.id && channelId !== this.state.currentChannel.id) {
            // Si le message vient d'un autre canal, on ne met PAS à jour le panneau de fichiers courant
            return;
        }

        const filesPanel = document.getElementById('files-panel');
        const filesList = document.getElementById('files-list');
        
        // Stocker les fichiers en attente même si le panneau est fermé
        if (attachments && attachments.length > 0) {
            attachments.forEach(att => {
                // Vérifier si ce fichier existe déjà dans les fichiers en attente
                const exists = this.state.pendingFiles.some(f => 
                    (f.id || f.file_id) === (att.id || att.file_id)
                );
                
                if (!exists) {
                    this.state.pendingFiles.unshift(att);
                }
            });
        }
        
        // Si la liste n'existe pas, on ne peut rien faire d'autre
        if (!filesList) {
            return;
        }
        
        // Vérifier si le panneau est encore en chargement
        const loadingState = filesList.querySelector('.files-loading');
        if (loadingState) {
            console.log('[KRONOS] Panneau encore en chargement, fichiers gardés en attente');
            return;
        }
        
        console.log('[KRONOS] Mise à jour en temps réel du panneau de fichiers avec', attachments.length, 'nouvelles pièces jointes');
        
        // Récupérer les IDs des fichiers déjà présents dans le DOM pour éviter les doublons
        const existingFileIds = new Set();
        filesList.querySelectorAll('.file-item').forEach(item => {
            existingFileIds.add(item.dataset.fileId);
        });
        
        // Filtrer les fichiers qui ne sont pas déjà dans le DOM
        const filesToAdd = attachments.filter(att => !existingFileIds.has(att.id));
        
        if (filesToAdd.length === 0) {
            return;
        }
        
        // Retirer l'état vide s'il existe
        const emptyState = filesList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
        
        // Vérifier si un conteneur grid existe, sinon le créer
        let filesGrid = filesList.querySelector('.files-grid');
        if (!filesGrid) {
            // Créer le conteneur grid
            filesGrid = document.createElement('div');
            filesGrid.className = 'files-grid';
            filesList.appendChild(filesGrid);
        }
        
        // Créer les nouveaux éléments de fichiers
        const fragment = document.createDocumentFragment();
        
        filesToAdd.forEach(att => {
            // Préparer les données du fichier avec size_formatted si nécessaire
            const fileData = {
                ...att,
                size_formatted: att.size_formatted || this.formatBytes(att.size || 0)
            };
            
            const fileItemHtml = this.renderFileItem(fileData);
            if (fileItemHtml) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = fileItemHtml;
                const fileItem = tempDiv.firstElementChild;
                
                if (fileItem) {
                    // Ajouter l'animation d'entrée
                    fileItem.style.opacity = '0';
                    fileItem.style.transform = 'translateY(-10px)';
                    fragment.insertBefore(fileItem, fragment.firstChild);
                }
            }
        });
        
        // Insérer tous les nouveaux éléments au début du grid
        filesGrid.insertBefore(fragment, filesGrid.firstChild);
        
        // Appliquer l'animation
        requestAnimationFrame(() => {
            filesGrid.querySelectorAll('.file-item').forEach((item, index) => {
                if (index < filesToAdd.length) {
                    item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    item.style.opacity = '1';
                    item.style.transform = 'translateY(0)';
                }
            });
        });
        
        // Mettre à jour le compteur de fichiers
        this.updateFilesCount();
    },
    
    // Gérer les nouvelles pièces jointes pour les conversations privées
    handleNewPrivateAttachments: function(attachments, channelId) {
        // Vérifier si nous sommes dans la bonne conversation privée
        if (!this.state.dm.current || this.state.dm.current.channel?.id !== channelId) {
            return;
        }

        const filesList = document.getElementById('private-files-list');
        if (!filesList) {
            return;
        }

        // Vérifier si le panneau est encore en chargement
        const loadingState = filesList.querySelector('.files-loading');
        if (loadingState) {
            // Si c'est en chargement, loadPrivateFileHistory s'en occupera
            return;
        }

        console.log('[KRONOS] Mise à jour temps réel des fichiers privés avec', attachments.length, 'pièces jointes');

        // Récupérer les IDs des fichiers déjà présents
        const existingFileIds = new Set();
        filesList.querySelectorAll('.file-item').forEach(item => {
            existingFileIds.add(item.dataset.fileId);
        });

        // Filtrer les nouveaux fichiers
        const filesToAdd = attachments.filter(att => !existingFileIds.has(att.id));

        if (filesToAdd.length === 0) {
            return;
        }

        // Retirer l'état vide
        const emptyState = filesList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        // Conteneur grid
        let filesGrid = filesList.querySelector('.files-grid');
        if (!filesGrid) {
            filesGrid = document.createElement('div');
            filesGrid.className = 'files-grid';
            filesList.appendChild(filesGrid);
        }

        // Créer les éléments
        const fragment = document.createDocumentFragment();

        filesToAdd.forEach(att => {
             const fileData = {
                ...att,
                size_formatted: att.size_formatted || this.formatBytes(att.size || 0)
            };
            
            const fileItemHtml = this.renderFileItem(fileData);
            if (fileItemHtml) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = fileItemHtml;
                const fileItem = tempDiv.firstElementChild;
                
                if (fileItem) {
                    fileItem.style.opacity = '0';
                    fileItem.style.transform = 'translateY(-10px)';
                    fragment.insertBefore(fileItem, fragment.firstChild);
                }
            }
        });

        filesGrid.insertBefore(fragment, filesGrid.firstChild);

        // Animation
        requestAnimationFrame(() => {
            filesGrid.querySelectorAll('.file-item').forEach((item, index) => {
                if (index < filesToAdd.length) {
                    item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    item.style.opacity = '1';
                    item.style.transform = 'translateY(0)';
                }
            });
        });
        
        // Ajouter les écouteurs d'événements pour les nouveaux fichiers
        filesToAdd.forEach(att => {
             const btn = filesList.querySelector(`.file-preview-btn[data-file-id="${att.id}"]`);
             if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const fileId = btn.dataset.fileId;
                    const fileType = btn.dataset.fileType;
                    this.previewFile(fileId, fileType);
                });
             }
        });
    },

    // Créer un élément de fichier pour l'insertion directe dans le DOM
    createFileItemElement: function(attachment, author) {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.dataset.fileId = attachment.id || attachment.file_id;
        
        // Déterminer le type de fichier et l'icône
        const isImage = attachment.type === 'image';
        const isVideo = attachment.type === 'video';
        const isAudio = attachment.type === 'audio';
        const isDocument = attachment.type === 'document';
        const isFile = attachment.type === 'file';
        
        // Obtenir l'URL du fichier
        const fileUrl = attachment.url || `/api/files/${attachment.id || attachment.file_id}`;
        const fileName = attachment.name || attachment.filename || 'Fichier';
        const fileSize = this.formatBytes(attachment.size || 0);
        const fileType = attachment.type || 'file';
        
        // Construire l'icône selon le type
        let iconSvg;
        if (isImage) {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
        } else if (isVideo) {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
        } else if (isAudio) {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
        } else if (isDocument) {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
        } else {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>`;
        }
        
        // Construire l'aperçu si c'est une image
        let previewHtml = '';
        if (isImage) {
            previewHtml = `<div class="file-preview-container">
                <img src="${fileUrl}" alt="${this.escapeHtml(fileName)}" class="file-preview-image" onerror="this.parentElement.style.display='none'">
            </div>`;
        } else if (isVideo) {
            previewHtml = `<div class="file-preview-container">
                <video src="${fileUrl}" class="file-preview-video" preload="metadata" onerror="this.parentElement.style.display='none'"></video>
                <div class="file-preview-overlay">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </div>
            </div>`;
        } else if (isAudio) {
            previewHtml = `<div class="file-preview-container">
                <audio src="${fileUrl}" class="file-preview-audio" controls onerror="this.parentElement.style.display='none'"></audio>
            </div>`;
        }
        
        // Construire le HTML de l'élément de fichier
        div.innerHTML = `
            <div class="file-icon">${iconSvg}</div>
            <div class="file-info">
                <div class="file-name" title="${this.escapeHtml(fileName)}">${this.escapeHtml(fileName)}</div>
                <div class="file-meta">
                    <span class="file-size">${fileSize}</span>
                    <span class="file-type">${fileType.toUpperCase()}</span>
                    ${author ? `<span class="file-author">par ${this.escapeHtml(author.display_name || author.username)}</span>` : ''}
                </div>
            </div>
            ${previewHtml}
            <div class="file-actions">
                <a href="${fileUrl}" download="${this.escapeHtml(fileName)}" class="file-action-btn" title="Télécharger">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
                <button class="file-action-btn file-preview-btn" data-file-url="${fileUrl}" data-file-type="${fileType}" title="Aperçu">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
            </div>
        `;
        
        // Ajouter les écouteurs d'événements pour les boutons d'action
        const previewBtn = div.querySelector('.file-preview-btn');
        if (previewBtn) {
            previewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = previewBtn.dataset.fileUrl;
                const type = previewBtn.dataset.fileType;
                this.openFilePreview(url, type, fileName);
            });
        }
        
        return div;
    },
    
    // Mettre à jour le compteur de fichiers dans le panneau
    updateFilesCount: function() {
        const filesList = document.getElementById('files-list');
        const countElement = document.getElementById('files-count');
        
        if (!filesList || !countElement) return;
        
        const fileCount = filesList.querySelectorAll('.file-item').length;
        countElement.textContent = fileCount;
        
        // Mettre à jour l'attribut data-count pour le styling
        filesList.dataset.fileCount = fileCount;
    },
    
    // Ouvrir la prévisualisation d'un fichier
    openFilePreview: function(url, type, fileName) {
        console.log('[KRONOS] Ouverture prévisualisation:', url, type);
        
        // Créer ou récupérer la modal de prévisualisation
        let modal = document.getElementById('file-preview-modal');
        
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'file-preview-modal';
            modal.innerHTML = `
                <div class="preview-backdrop"></div>
                <div class="preview-container">
                    <button class="preview-close" id="close-preview">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                    <div class="preview-content" id="preview-content"></div>
                    <div class="preview-footer">
                        <span class="preview-filename">${this.escapeHtml(fileName)}</span>
                        <a href="${url}" download="${this.escapeHtml(fileName)}" class="preview-download-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Télécharger
                        </a>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Configurer les écouteurs de la modal
            const closeBtn = modal.querySelector('#close-preview');
            const backdrop = modal.querySelector('.preview-backdrop');
            
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeFilePreview());
            }
            if (backdrop) {
                backdrop.addEventListener('click', () => this.closeFilePreview());
            }
            
            // Fermer avec Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('open')) {
                    this.closeFilePreview();
                }
            });
        }
        
        // Déterminer le contenu à afficher selon le type
        const content = modal.querySelector('#preview-content');
        content.innerHTML = '';
        content.className = 'preview-content';
        
        if (type === 'image') {
            content.innerHTML = `<img src="${url}" alt="${this.escapeHtml(fileName)}" class="preview-image">`;
            content.classList.add('image');
        } else if (type === 'video') {
            content.innerHTML = `
                <video src="${url}" controls autoplay class="preview-video">
                    Votre navigateur ne supporte pas la lecture de vidéos.
                </video>
            `;
            content.classList.add('video');
        } else if (type === 'audio') {
            content.innerHTML = `
                <div class="audio-player-large">
                    <div class="audio-waveform">
                        <svg viewBox="0 0 200 50" preserveAspectRatio="none">
                            ${this.generateWaveformSVG()}
                        </svg>
                    </div>
                    <audio src="${url}" controls autoplay class="preview-audio"></audio>
                </div>
            `;
            content.classList.add('audio');
        } else {
            // Pour les autres types, afficher une icône et un lien de téléchargement
            content.innerHTML = `
                <div class="preview-generic">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                        <path d="M13 2v7h7"/>
                    </svg>
                    <p>Fichier non prévisualisable</p>
                </div>
            `;
            content.classList.add('generic');
        }
        
        // Mettre à jour le nom du fichier dans le footer
        const filenameEl = modal.querySelector('.preview-filename');
        if (filenameEl) {
            filenameEl.textContent = fileName;
        }
        
        // Mettre à jour le lien de téléchargement
        const downloadBtn = modal.querySelector('.preview-download-btn');
        if (downloadBtn) {
            downloadBtn.href = url;
            downloadBtn.download = fileName;
        }
        
        // Afficher la modal
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    },
    
    // Fermer la prévisualisation d'un fichier
    closeFilePreview: function() {
        const modal = document.getElementById('file-preview-modal');
        if (modal) {
            modal.classList.remove('open');
            document.body.style.overflow = '';
            
            // Arrêter la lecture si nécessaire
            const video = modal.querySelector('video');
            const audio = modal.querySelector('audio');
            if (video) video.pause();
            if (audio) audio.pause();
        }
    },
    
    // Générer le SVG pour la forme d'onde audio
    generateWaveformSVG: function() {
        let bars = '';
        for (let i = 0; i < 50; i++) {
            const height = Math.random() * 30 + 10;
            const x = (i * 4);
            bars += `<rect x="${x}" y="${(50 - height) / 2}" width="3" height="${height}" fill="var(--accent)" class="waveform-bar"/>`;
        }
        return bars;
    },
    
    // Gérer l'édition d'un message
    handleMessageEdited: function(message) {
        if (!message) return;
        const element = document.querySelector(`[data-message-id="${message.id}"]`);
        if (element) {
            if (element.classList.contains('private-message')) {
                const div = document.createElement('div');
                div.className = element.className;
                div.dataset.messageId = message.id;
                const avatar = message.author?.avatar_url || message.author?.avatar || '/static/icons/default_avatar.svg';
                const name = message.author?.display_name || message.author?.username || '';
                const time = this.formatTime(message.created_at);
                div.innerHTML = `
                    <img class="private-message-avatar" src="${avatar}" alt="">
                    <div class="private-message-content">
                        <div class="private-message-author">${this.escapeHtml(name)}</div>
                        <div class="private-message-bubble">${this.escapeHtml(message.content || '')}</div>
                        <div class="private-message-meta">
                            <span class="private-message-time">${time}</span>
                        </div>
                    </div>
                `;
                // Pièces jointes
                if (message.attachments && message.attachments.length > 0) {
                    const attachmentsHtml = this.renderAttachmentsHtml(message.attachments);
                    const contentDiv = div.querySelector('.private-message-content');
                    if (contentDiv) {
                        const bubble = contentDiv.querySelector('.private-message-bubble');
                        if (bubble) bubble.insertAdjacentHTML('afterend', attachmentsHtml);
                    }
                }
                // Actions (barre publique)
                const canEdit = (message.author?.id === this.state.user?.id) || (this.state.user?.role === 'admin' || this.state.user?.role === 'supreme' || this.state.user?.is_admin);
                if (canEdit) {
                    const bar = document.createElement('div');
                    bar.className = 'message-actions-bar';
                    bar.innerHTML = `
                        <button class="action-btn-edit" title="Modifier">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="action-btn-delete" title="Supprimer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    `;
                    div.appendChild(bar);
                    bar.querySelector('.action-btn-edit')?.addEventListener('click', (e) => { e.stopPropagation(); this.editMessage(message); });
                    bar.querySelector('.action-btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); this.deleteMessage(message.id); });
                }
                element.replaceWith(div);
            } else {
                const newElement = this.createMessageElement(message);
                if (newElement) {
                    element.replaceWith(newElement);
                }
            }
        }

        // Mettre à jour le cache local pour le bon channel
        let chId = message.channel_id || null;
        if (!chId) {
            // trouver via cache
            for (const [cid, arr] of Object.entries(this.state.messages || {})) {
                if (Array.isArray(arr) && arr.find(m => m.id === message.id)) {
                    chId = parseInt(cid, 10);
                    break;
                }
            }
        }
        if (chId) {
            if (!this.state.messages[chId]) this.state.messages[chId] = [];
            const arr = this.state.messages[chId];
            const idx = arr.findIndex(m => m.id === message.id);
            if (idx !== -1) arr[idx] = message;
        }

        // Si c'est un DM: mettre à jour l'aperçu si nécessaire
        if (this.state.dm && Array.isArray(this.state.dm.conversations)) {
            let updated = false;
            if (chId) {
                const cidx = this.state.dm.conversations.findIndex(c => c.channel && c.channel.id === chId);
                if (cidx !== -1) {
                    const conv = this.state.dm.conversations[cidx];
                    const lm = conv.last_message;
                    const isLatest = !lm || new Date(message.created_at).getTime() >= new Date(lm.created_at || 0).getTime();
                    if (isLatest || (lm && lm.id === message.id)) {
                        conv.last_message = message;
                        this.state.dm.conversations.splice(cidx, 1);
                        this.state.dm.conversations.unshift(conv);
                        updated = true;
                    }
                }
            }
            if (!updated) {
                // Fallback: si on ne connaît pas le channel mais que c'est le dernier message
                this.state.dm.conversations.forEach(conv => {
                    if (conv.last_message && conv.last_message.id === message.id) {
                        conv.last_message = message;
                        updated = true;
                    }
                });
            }
            if (updated) {
                this.renderDMConversations();
            }
        }
    },
    
    // Gérer la suppression d'un message
    handleMessageDeleted: function(data) {
        if (!data || !data.message_id) return;
        const msgId = data.message_id;
        let channelId = data.channel_id || null;

        // 1) Retirer du DOM (public ou privé)
        const element = document.querySelector(`[data-message-id="${msgId}"]`);
        if (element) {
            element.style.opacity = '0';
            element.style.transform = 'translateX(-20px)';
            element.style.transition = 'all 0.3s ease';
            setTimeout(() => element.remove(), 300);
        }

        // 2) Déduire le channel si absent
        if (!channelId) {
            for (const [cid, arr] of Object.entries(this.state.messages || {})) {
                if (Array.isArray(arr) && arr.find(m => m.id === msgId)) {
                    channelId = parseInt(cid, 10);
                    break;
                }
            }
        }

        // 3) Mettre à jour le cache local des messages
        let removedMessage = null;
        let arr = null;
        if (channelId && this.state.messages && this.state.messages[channelId]) {
            arr = this.state.messages[channelId];
            const idx = arr.findIndex(m => m.id === msgId);
            if (idx !== -1) {
                removedMessage = arr[idx];
                arr.splice(idx, 1);
            }
        }

        // 4) Si c'est un DM: corriger l'aperçu (last_message)
        if (this.state.dm && Array.isArray(this.state.dm.conversations)) {
            let cidx = -1;
            if (channelId) {
                cidx = this.state.dm.conversations.findIndex(c => c.channel && c.channel.id === channelId);
            }
            if (cidx === -1) {
                cidx = this.state.dm.conversations.findIndex(c => c.last_message && c.last_message.id === msgId);
            }
            if (cidx !== -1) {
                const conv = this.state.dm.conversations[cidx];
                if (conv.last_message && conv.last_message.id === msgId) {
                    let nextLast = null;
                    const arr2 = this.state.messages && this.state.messages[channelId] ? this.state.messages[channelId] : null;
                    if (arr2 && arr2.length > 0) {
                        nextLast = arr2[arr2.length - 1];
                    }
                    // Fallback: recharger si on n'a pas le cache
                    if (!nextLast) {
                        this.loadMessages(channelId).then(() => {
                            const fresh = this.state.messages[channelId] || [];
                            conv.last_message = fresh.length > 0 ? fresh[fresh.length - 1] : null;
                            this.renderDMConversations();
                        });
                    } else {
                        conv.last_message = nextLast;
                        this.renderDMConversations();
                    }
                }
                const wasOpen = this.state.dm.current?.channel?.id === channelId;
                if (!wasOpen && removedMessage && removedMessage.author?.id !== this.state.user?.id && conv.unread_count > 0) {
                    conv.unread_count = Math.max(0, (conv.unread_count || 0) - 1);
                }
                if (arr && this.state.user) {
                    const uid = this.state.user.id;
                    const uname = this.state.user.username || '';
                    const hasMentionLeft = arr.some(m => {
                        if (!m) return false;
                        if (Array.isArray(m.mentioned_user_ids) && m.mentioned_user_ids.includes(uid)) return true;
                        if (m.content && (m.content.includes(`@${uname}`) || m.content.includes('@everyone'))) return true;
                        return false;
                    });
                    conv.has_mention_unread = hasMentionLeft && (conv.unread_count || 0) > 0;
                }
                this.renderDMConversations();
            }
        }
        // 5) Public: décrémenter les compteurs si présent
        if (channelId && (!this.state.dm || !this.state.dm.conversations?.some(c => c.channel?.id === channelId))) {
            const key = String(channelId);
            if (this.state.channelUnread && this.state.channelUnread[key] > 0) {
                this.state.channelUnread[key] = Math.max(0, this.state.channelUnread[key] - 1);
            }
            if (arr && this.state.user) {
                const uid = this.state.user.id;
                const uname = this.state.user.username || '';
                const hasMentionLeft = arr.some(m => {
                    if (!m) return false;
                    if (Array.isArray(m.mentioned_user_ids) && m.mentioned_user_ids.includes(uid)) return true;
                    if (m.content && (m.content.includes(`@${uname}`) || m.content.includes('@everyone'))) return true;
                    return false;
                });
                if (!hasMentionLeft && this.state.channelMentionUnread && this.state.channelMentionUnread[channelId]) {
                    delete this.state.channelMentionUnread[channelId];
                }
            }
            this.renderChannels();
        }
    },
    
    // Gérer les réactions
    handleReactionUpdated: function(data) {
        if (!data || !data.message_id) return;
        
        const element = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (element && data.reactions) {
            const reactionsContainer = element.querySelector('.message-reactions');
            const message = this.state.messages[this.state.currentChannel?.id]?.find(m => m.id === data.message_id);
            
            if (message && reactionsContainer) {
                data.reactions.forEach(reaction => {
                    const btn = reactionsContainer.querySelector(`[data-emoji="${reaction.emoji}"]`);
                    if (btn) {
                        btn.querySelector('.count').textContent = reaction.count;
                        if (reaction.user_ids?.includes(this.state.user.id)) {
                            btn.classList.add('reacted');
                        } else {
                            btn.classList.remove('reacted');
                        }
                    }
                });
                
                message.reactions = data.reactions;
            }
        }
    },
    
    // Gérer l'indicateur de frappe
    handleUserTyping: function(data) {
        if (!data) return;
        
        if (data.channel_id !== this.state.currentChannel?.id) return;
        
        if (data.is_typing) {
            this.state.typingUsers.set(data.user_id, data);
        } else {
            this.state.typingUsers.delete(data.user_id);
        }
        
        this.updateTypingIndicator();
    },
    
    // Mettre à jour l'indicateur de frappe
    updateTypingIndicator: function() {
        const typingUsers = Array.from(this.state.typingUsers.values())
            .filter(u => u.channel_id === this.state.currentChannel?.id && u.user_id !== this.state.user.id);
        
        if (!this.elements.typingIndicator) return;
        
        if (typingUsers.length === 0) {
            this.elements.typingIndicator.style.display = 'none';
            return;
        }
        
        this.elements.typingIndicator.style.display = 'flex';
        
        const names = typingUsers.map(u => u.display_name || u.username);
        let text = '';
        
        if (names.length === 1) {
            text = `${names[0]} est en train d'écrire...`;
        } else if (names.length === 2) {
            text = `${names[0]} et ${names[1]} sont en train d'écrire...`;
        } else {
            text = `${names[0]} et ${names.length - 1} autres sont en train d'écrire...`;
        }
        
        const typingText = this.elements.typingIndicator.querySelector('.typing-text');
        if (typingText) {
            typingText.textContent = text;
        }
    },
    
    // Gérer la connexion d'un utilisateur
    handleUserConnected: function(user) {
        if (user && user.id) {
            this.state.onlineUsers.add(user.id);
            console.log('[KRONOS] Utilisateur connecté:', user.username, '- ID:', user.id);
            this.updateUserStatus(user.id, true);
            this.loadMembers();
        }
    },
    
    // Gérer la déconnexion d'un utilisateur
    handleUserDisconnected: function(data) {
        if (data && data.user_id) {
            this.state.onlineUsers.delete(data.user_id);
            console.log('[KRONOS] Utilisateur déconnecté:', data.user_id);
            this.updateUserStatus(data.user_id, false);
            this.loadMembers();
        }
    },
    
    // Mettre à jour le statut d'un utilisateur dans l'interface
    updateUserStatus: function(userId, isOnline) {
        console.log(`[KRONOS] updateUserStatus: userId=${userId}, isOnline=${isOnline}`);
        
        // Cibler .member-status-indicator (utilisé dans buildMemberItem)
        const memberElements = document.querySelectorAll('.member-item[data-user-id]');
        memberElements.forEach(el => {
            if (el.dataset.userId === userId) {
                // Cibler member-status-indicator comme dans le template
                const statusIndicator = el.querySelector('.member-status-indicator');
                const statusDot = el.querySelector('.status-dot'); // Fallback pour anciens sélecteurs
                const statusText = el.querySelector('.member-status-text');
                const lastSeen = el.querySelector('.member-last-seen');
                
                // Mettre à jour l'indicateur principal
                if (statusIndicator) {
                    statusIndicator.classList.remove('online', 'offline', 'away', 'dnd');
                    statusIndicator.classList.add(isOnline ? 'online' : 'offline');
                }
                
                // Fallback pour status-dot (anciens sélecteurs)
                if (statusDot) {
                    statusDot.classList.remove('online', 'offline', 'away', 'dnd');
                    statusDot.classList.add(isOnline ? 'online' : 'offline');
                }
                
                // Mettre à jour le texte de statut
                if (statusText) {
                    statusText.textContent = isOnline ? 'En ligne' : 'Hors ligne';
                }
                
                // Mettre à jour last-seen si présent
                if (lastSeen && !isOnline) {
                    lastSeen.textContent = 'Hors ligne';
                }
                
                // Mettre à jour le dataset pour référence future
                el.dataset.isOnline = isOnline.toString();
                
                console.log(`[KRONOS] Statut mis à jour pour ${userId}: ${isOnline ? 'En ligne' : 'Hors ligne'}`);
            }
        });
    },
    
    // Rafraîchir la présence des utilisateurs
    refreshPresence: function() {
        if (this.socket && this.state.isConnected) {
            // Émettre un ping pour mettre à jour notre présence
            this.socket.emit('ping');
            
            // Demander la liste mise à jour des membres
            this.loadMembers();
        }
    },
    
    // Gérer le rejoint d'un salon
    handleJoinedChannel: function(data) {
        if (data.user?.id === this.state.user?.id) {
            console.log('[KRONOS] Rejoint le salon:', data.channel_id);
        }
    },
    
    // Gérer l'expulsion avec URL de redirection personnalisée
    handleKicked: function(data) {
        this.showNotification(data.reason || 'Vous avez été expulsé', 'error');
        
        // Si une URL de redirection est fournie, rediriger immédiatement
        if (data.redirect_url) {
            console.log('[KRONOS] Redirection vers:', data.redirect_url);
            setTimeout(() => {
                window.location.href = data.redirect_url;
            }, 1000);
        } else {
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        }
    },
    
    // Gérer la promotion automatique (IP matching)
    handleAutoPromoted: function(data) {
        this.showNotification(`Vous êtes maintenant ${data.role === 'supreme' ? 'Admin Suprême' : 'Admin'}! (${data.reason})`, 'success');
        
        // Mettre à jour le rôle de l'utilisateur
        if (this.state.user) {
            this.state.user.role = data.role;
            this.updateUserIndicator();
        }
    },
    
    // Gérer la complétion d'une action admin
    handleAdminActionComplete: function(data) {
        this.showNotification(data.message, 'success');
        console.log('[KRONOS] Action admin:', data.action, 'sur', data.target_user?.username);
        
        // Recharger la liste des membres
        this.loadMembers();
    },
    
    // Rafraîchir le profil ouvert en temps réel
    refreshProfileOverlay: function() {
        if (!this.state.profileOverlayUserId) return;
        
        const overlay = document.getElementById('profile-overlay');
        if (!overlay || !overlay.classList.contains('open')) return;
        
        // Récupérer les données les plus récentes de l'utilisateur
        const user = this.state.allUsersMap?.[this.state.profileOverlayUserId];
        if (!user) return;
        
        console.log('[KRONOS] Rafraîchissement du profil pour:', user.username);
        
        // Mettre à jour le rôle et les boutons
        const roleEl = overlay.querySelector('.profile-modal-role');
        const actionsEl = overlay.querySelector('.profile-admin-actions');
        
        if (roleEl) {
            const roleTranslations = {
                'supreme': 'Admin Suprême',
                'admin': 'Administrateur',
                'moderator': 'Modérateur',
                'member': 'Membre'
            };
            const roleIcons = {
                'supreme': '👑',
                'admin': '⭐',
                'moderator': '🛡️',
                'member': '👤'
            };
            const roleLabel = roleTranslations[user.role] || 'Membre';
            const roleIcon = roleIcons[user.role] || '👤';
            
            roleEl.className = `profile-modal-role ${user.role || 'member'}`;
            roleEl.innerHTML = `<span class="role-icon">${roleIcon}</span> ${roleLabel}`;
        }
        
        if (actionsEl) {
            // Reconstruire les boutons admin basés sur le nouveau rôle
            const isSelf = user.id === this.state.user?.id;
            const isAdmin = this.state.user?.role === 'admin' || this.state.user?.role === 'supreme';
            
            if (!isAdmin || isSelf) {
                actionsEl.innerHTML = '';
            } else {
                // Reconstruire les boutons selon le rôle actuel
                const isTargetAdmin = user.role === 'admin' || user.role === 'supreme';
                const isTargetModerator = user.role === 'moderator';
                
                actionsEl.innerHTML = `
                    <div class="profile-admin-actions">
                        ${!isTargetAdmin ? `
                            <button class="btn-action btn-action-promote" data-user-id="${user.id}" data-action="promote" title="Promouvoir Admin">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                    <path d="M2 17l10 5 10-5"/>
                                    <path d="M2 12l10 5 10-5"/>
                                </svg>
                                Promouvoir
                            </button>
                        ` : user.role === 'moderator' ? `
                            <button class="btn-action btn-action-promote" data-user-id="${user.id}" data-action="promote" title="Promouvoir Admin">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                    <path d="M2 17l10 5 10-5"/>
                                    <path d="M2 12l10 5 10-5"/>
                                </svg>
                                Promouvoir
                            </button>
                        ` : ''}
                        ${isTargetAdmin || isTargetModerator ? `
                            <button class="btn-action btn-action-demote" data-user-id="${user.id}" data-action="demote" title="Retrograder">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M2 12l10 5 10-5"/>
                                </svg>
                                Retrograder
                            </button>
                        ` : ''}
                        ${!user.is_active ? `
                            <button class="btn-action btn-action-unban" data-user-id="${user.id}" data-action="unban" title="Débannir">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                    <circle cx="8.5" cy="7" r="4"/>
                                    <polyline points="17 11 19 13 23 9"/>
                                </svg>
                                Débannir
                            </button>
                        ` : `
                            <button class="btn-action btn-action-kick" data-user-id="${user.id}" data-action="kick" title="Expulser">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                                Expulser
                            </button>
                            <button class="btn-action btn-action-ban" data-user-id="${user.id}" data-action="ban" title="Bannir">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                                </svg>
                                Bannir
                            </button>
                        `}
                        ${!user.is_shadowbanned ? `
                            <button class="btn-action btn-action-shadowban" data-user-id="${user.id}" data-action="shadowban" title="Shadowban">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M17.5 6.5C17.5 6.5 19 8 19 10.5C19 13 17.5 15 15 15"/>
                                    <path d="M3 3L21 21"/>
                                    <path d="M9.5 9.5C9.5 9.5 8 11 8 13.5C8 16 9.5 18 12 18"/>
                                </svg>
                                Shadowban
                            </button>
                        ` : `
                            <button class="btn-action btn-action-unshadowban" data-user-id="${user.id}" data-action="unshadowban" title="Retirer shadowban">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M17.5 6.5C17.5 6.5 19 8 19 10.5C19 13 17.5 15 15 15"/>
                                </svg>
                                De-shadowban
                            </button>
                        `}
                    </div>
                `;
                
                // Réinstaller les écouteurs sur les nouveaux boutons
                actionsEl.querySelectorAll('.btn-action').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = btn.dataset.action;
                        const userId = btn.dataset.userId;
                        
                        switch (action) {
                            case 'promote':
                                if (confirm('Promouvoir cet utilisateur au rang Admin ?')) {
                                    this.promoteUser(userId);
                                }
                                break;
                            case 'demote':
                                if (confirm('Retrograder cet utilisateur au rang Membre ?')) {
                                    this.demoteUser(userId);
                                }
                                break;
                            case 'kick':
                                const kickUrl = prompt('URL de redirection (laissez vide pour /login):', '/login');
                                if (kickUrl === null) return;
                                const kickReason = prompt('Raison de l\'expulsion (optionnel):', '');
                                if (kickReason === null) kickReason = '';
                                this.kickUser(userId, kickUrl, kickReason);
                                break;
                            case 'ban':
                                const reason = prompt('Raison du bannissement:');
                                this.banUser(userId, reason);
                                break;
                            case 'unban':
                                if (confirm('Debannir cet utilisateur ?')) {
                                    this.unbanUser(userId);
                                }
                                break;
                            case 'shadowban':
                                this.toggleShadowban(userId);
                                break;
                            case 'unshadowban':
                                this.toggleShadowban(userId);
                                break;
                        }
                    });
                });
            }
        }
    },
    
    // Gérer le changement de rôle d'un utilisateur
    handleRoleChange: function(data) {
        console.log('[KRONOS] Changement de rôle reçu:', data);
        
        const { user_id, username, new_role, performed_by } = data;
        
        // Notification
        const isSelf = user_id === this.state.user?.id;
        if (isSelf) {
            this.showNotification(`Votre rôle a été modifié: ${new_role}`, 'info');
        } else {
            this.showNotification(`@${username} est maintenant ${new_role}`, 'info');
        }
        
        // Mettre à jour l'utilisateur courant si concerné
        if (isSelf && this.state.user) {
            this.state.user.role = new_role;
            this.updateUserIndicator();
        }
        
        // Mettre à jour dans la map des utilisateurs
        if (this.state.allUsersMap && this.state.allUsersMap[user_id]) {
            this.state.allUsersMap[user_id].role = new_role;
        }
        
        // Rafraîchir le profil si c'est l'utilisateur affiché
        if (user_id === this.state.profileOverlayUserId) {
            this.refreshProfileOverlay();
        }
        
        // Fermer le menu contextuel s'il est ouvert (données désormais obsolètes)
        this.hideContextMenu();
        
        // Recharger la liste des membres pour mettre à jour l'interface
        this.loadMembers();
    },
    
    // Gérer les messages shadowbannis (pour les admins)
    handleShadowbannedMessage: function(data) {
        console.log('[KRONOS] Message shadowbanni détecté de:', data.shadowbanned_user?.username);
        // Optionnel: notification silencieuse pour les admins
    },
    
    // Gérer le bannissement de l'utilisateur courant
    handleBanned: function(data) {
        // Afficher la raison du ban de manière explicite
        const reasonText = data.reason ? `Raison: ${data.reason}` : '';
        this.showNotification(`Vous avez été banni. ${reasonText}`, 'error');
        setTimeout(() => {
            window.location.href = '/login?banned=true';
        }, 3000);
    },
    
    // Gérer la notification qu'un utilisateur a été banni (pour les autres utilisateurs)
    handleUserBanned: function(data) {
        this.showNotification(`@${data.username} a été banni par ${data.banned_by}`, 'info');
        console.log('[KRONOS] Utilisateur banni:', data.username);
        this.loadMembers();  // Recharger la liste des membres
    },
    
    // Gérer la notification qu'un utilisateur a été débanni (pour les autres utilisateurs)
    handleUserUnbanned: function(data) {
        this.showNotification(`@${data.username} a été rétabli par ${data.unbanned_by}`, 'success');
        console.log('[KRONOS] Utilisateur rétabli:', data.username);
        this.loadMembers();  // Recharger la liste des membres
    },
    
    // Gérer la liste des membres (nouveau format avec onglets)
    handleMembersList: function(data) {
        console.log('[KRONOS] Liste des membres reçue:', data.members?.length, 'membres,', 
                    data.banned?.length, 'bannis,', data.shadowbanned?.length, 'shadowbannis');
        
        // Stocker les données pour affichage
        this.state.members = data.members || [];
        this.state.bannedUsers = data.banned || [];
        this.state.shadowbannedUsers = data.shadowbanned || [];
        
        // Mettre à jour la liste des utilisateurs en ligne
        if (data.online_user_ids) {
            this.state.onlineUsers = new Set(data.online_user_ids);
        }
        
        // Créer une map pour accéder rapidement aux données utilisateur
        this.state.allUsersMap = {};
        [...this.state.members, ...this.state.bannedUsers, ...this.state.shadowbannedUsers].forEach(u => {
            this.state.allUsersMap[u.id] = u;
        });
        
        // Recharger l'affichage des membres
        this.renderMembersWithTabs(data);
    },
    
    // Afficher les membres et bannis avec onglets
    renderMembersWithTabs: function(data) {
        const members = data.members || [];
        const banned = data.banned || [];
        const shadowbanned = data.shadowbanned || [];
        
        // Mettre à jour les compteurs
        const countMembers = document.getElementById('count-members');
        const countBanned = document.getElementById('count-banned');
        const memberCount = document.getElementById('member-count');
        
        if (countMembers) countMembers.textContent = members.length;
        if (countBanned) countBanned.textContent = banned.length;
        if (memberCount) memberCount.textContent = members.length;
        
        // Rendre les membres dans l'onglet approprié
        this.renderMembersWithStatus(members);
        
        // Rendre les bannis
        this.renderBannedList(banned, shadowbanned);
    },
    
    // Changer d'onglet dans le panneau des membres
    switchMembersTab: function(tabName) {
        console.log('[KRONOS] Changement d\'onglet membres vers:', tabName);
        
        this.state.currentMembersTab = tabName;
        
        const membersTab = document.querySelector('.members-tab[data-tab="members"]');
        const bannedTab = document.querySelector('.members-tab[data-tab="banned"]');
        const membersListContainer = document.getElementById('members-list-container');
        const bannedListContainer = document.getElementById('banned-list-container');
        const membersSearchContainer = document.getElementById('members-search-container');
        const membersStats = document.getElementById('members-stats');
        
        if (tabName === 'members') {
            if (membersTab) membersTab.classList.add('active');
            if (bannedTab) bannedTab.classList.remove('active');
            if (membersListContainer) membersListContainer.style.display = 'block';
            if (bannedListContainer) bannedListContainer.style.display = 'none';
            if (membersSearchContainer) membersSearchContainer.style.display = 'block';
            if (membersStats) membersStats.style.display = 'flex';
        } else {
            if (membersTab) membersTab.classList.remove('active');
            if (bannedTab) bannedTab.classList.add('active');
            if (membersListContainer) membersListContainer.style.display = 'none';
            if (bannedListContainer) bannedListContainer.style.display = 'block';
            if (membersSearchContainer) membersSearchContainer.style.display = 'none';
            if (membersStats) membersStats.style.display = 'none';
        }
    },
    
    // Afficher la liste des utilisateurs bannis
    renderBannedList: function(banned, shadowbanned) {
        const container = document.getElementById('banned-list');
        if (!container) return;
        
        // Combiner bannis et shadowbannis pour l'affichage
        const allBanned = [
            ...banned.map(u => ({ ...u, ban_type: 'banned' })),
            ...shadowbanned.map(u => ({ ...u, ban_type: 'shadowbanned' }))
        ];
        
        if (allBanned.length === 0) {
            container.innerHTML = `
                <div class="members-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                    </svg>
                    <p>Aucun utilisateur banni</p>
                </div>
            `;
            return;
        }
        
        // Trier par date de bannissement (plus récent en premier)
        allBanned.sort((a, b) => new Date(b.banned_at || b.created_at) - new Date(a.banned_at || a.created_at));
        
        container.innerHTML = allBanned.map(user => this.buildBannedItem(user)).join('');
        
        // Ajouter les écouteurs
        this.attachBannedListeners();
    },
    
    
    
    // Construire un élément de la liste des bannis
    buildBannedItem: function(user) {
        const isShadowbanned = user.ban_type === 'shadowbanned';
        const banDate = this.formatDate(user.banned_at || user.created_at);
        const banReason = user.ban_reason || 'Aucune raison spécifiée';
        const bannedBy = user.banned_by_name || 'Système';
        
        return `
            <div class="member-item banned-item" data-user-id="${user.id}">
                <div class="member-avatar">
                    <img src="${user.avatar || '/static/icons/default_avatar.svg'}" 
                         alt="${this.escapeHtml(user.display_name || user.username)}"
                         onerror="this.src='/static/icons/default_avatar.svg'">
                    <span class="status-dot banned"></span>
                </div>
                <div class="member-info">
                    <div class="member-name">
                        ${this.escapeHtml(user.display_name || user.username)}
                        ${user.role === 'supreme' ? '<span class="role-badge supreme">S</span>' : ''}
                        ${user.role === 'admin' || user.role === 'moderator' ? '<span class="role-badge admin">A</span>' : ''}
                        ${isShadowbanned ? '<span class="ban-badge shadowbanned">Shadow</span>' : ''}
                    </div>
                    <div class="member-meta">@${this.escapeHtml(user.username)}</div>
                    <div class="ban-info">
                        <span class="ban-reason" title="${this.escapeHtml(banReason)}">${this.escapeHtml(banReason)}</span>
                    </div>
                </div>
                <div class="member-actions">
                    <button class="action-btn unban-btn" data-user-id="${user.id}" title="Débannir">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="8.5" cy="7" r="4"/>
                            <polyline points="17 11 19 13 23 9"/>
                        </svg>
                    </button>
                    ${isShadowbanned ? `
                        <button class="action-btn unshadowban-btn" data-user-id="${user.id}" title="Retirer Shadowban">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    },
    
    // Ajouter les écouteurs aux éléments de la liste des bannis
    attachBannedListeners: function() {
        const container = document.getElementById('banned-list');
        if (!container) return;
        
        // Débannir un utilisateur
        container.querySelectorAll('.unban-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = btn.dataset.userId;
                this.unbanUser(userId);
            });
        });

        // Retirer le shadowban
        container.querySelectorAll('.unshadowban-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = btn.dataset.userId;
                this.toggleShadowban(userId);
            });
        });
    },
    
    // Charger les membres du salon - Version qualitative
    loadMembers: async function() {
        console.log('[KRONOS] loadMembers appelé - Version qualitative');
        
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
    
    // ============================================
    // MESSAGERIE PRIVÉE
    // ============================================
    
    
    
    
    
    
    
    
    
    
    

    

    

    
    
    
    
    
    
    
    // Formatage du temps écoulé
    formatTimeAgo: function(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return 'À l\'instant';
        if (minutes < 60) return `${minutes}m`;
        if (hours < 24) return `${hours}h`;
        if (days < 7) return `${days}j`;
        
        return date.toLocaleDateString('fr-FR');
    },
    
    // Version fallback - affiche l'utilisateur courant
    renderMembersFallback: function() {
        const members = [];
        
        // Ajouter l'utilisateur courant en premier (toujours en ligne)
        if (this.state.user) {
            members.push({
                ...this.state.user,
                online: true,
                status: 'online'
            });
        }
        
        // Les autres utilisateurs en ligne sont ajoutés via les événements socket
        this.renderMembersWithStatus(members);
    },
    
    // Afficher les membres avec sections par statut - Design qualitatif
    renderMembersWithStatus: function(members) {
        const container = this.elements.membersList;
        if (!container) return;
        
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
    
    // Construire une section de membres
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
    
    // Construir un élément de membre
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
    
    // Mettre à jour les statistiques des membres
    updateMembersStats: function(stats) {
        const statsContainer = document.getElementById('members-stats');
        if (!statsContainer) return;
        
        // Afficher le conteneur de stats
        statsContainer.style.display = 'flex';
        
        // Mettre à jour les compteurs
        const onlineEl = document.getElementById('stat-online');
        const awayEl = document.getElementById('stat-away');
        const offlineEl = document.getElementById('stat-offline');
        
        if (onlineEl) onlineEl.textContent = stats.online;
        if (awayEl) awayEl.textContent = stats.away + stats.dnd;
        if (offlineEl) offlineEl.textContent = stats.offline;
    },
    
    // Ajouter les écouteurs pour les membres
    attachMembersListeners: function() {
        const container = this.elements.membersList;
        if (!container) return;
        
        // Écouteur pour la recherche de membres
        const searchInput = document.getElementById('members-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterMembers(e.target.value);
            });
        }
        
        // Écouteurs pour les sections
        container.querySelectorAll('.members-section-header').forEach(header => {
            header.addEventListener('click', () => {
                const sectionId = header.dataset.section;
                const sectionContent = document.getElementById(sectionId);
                const toggle = header.querySelector('.members-section-toggle');
                
                if (sectionContent) {
                    sectionContent.classList.toggle('collapsed');
                }
                if (toggle) {
                    toggle.classList.toggle('collapsed');
                }
            });
        });
        
        // Écouteurs pour les éléments de membre
        container.querySelectorAll('.member-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Ne pas déclencher si clic sur un bouton d'action
                if (e.target.closest('.member-action-btn')) return;
                
                const userId = item.dataset.userId;
                const user = this.findMemberById(userId);
                if (user) {
                    this.showUserProfile(user);
                }
            });
            
            // Menu contextuel (clic droit)
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const userId = item.dataset.userId;
                const user = this.findMemberById(userId);
                if (user) {
                    this.showContextMenu(e, { author: user });
                }
            });
        });
        
        // Écouteurs pour les boutons d'action
        container.querySelectorAll('.member-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const userId = btn.dataset.userId;
                
                switch (action) {
                    case 'message':
                        this.showNotification('Fonctionnalité de message direct en développement', 'info');
                        break;
                    case 'profile':
                        const user = this.findMemberById(userId);
                        if (user) {
                            this.showUserProfile(user);
                        }
                        break;
                }
            });
        });
    },
    
    // Filtrer les membres par recherche
    filterMembers: function(searchTerm) {
        const container = this.elements.membersList;
        if (!container) return;
        
        const term = searchTerm.toLowerCase().trim();
        const items = container.querySelectorAll('.member-item');
        const sections = container.querySelectorAll('.members-section');
        
        items.forEach(item => {
            const name = item.querySelector('.member-name')?.textContent?.toLowerCase() || '';
            const username = item.dataset.username?.toLowerCase() || '';
            
            const matches = !term || name.includes(term) || username.includes(term);
            item.style.display = matches ? 'flex' : 'none';
        });
        
        // Masquer les sections vides
        sections.forEach(section => {
            const visibleItems = section.querySelectorAll('.member-item:not([style*="display: none"])');
            const content = section.querySelector('.members-section-content');
            if (content) {
                content.style.display = visibleItems.length > 0 ? 'flex' : 'none';
            }
        });
    },
    
    // Trouver un membre par ID
    findMemberById: function(userId) {
        // D'abord essayer de récupérer depuis allUsersMap (données les plus récentes)
        if (this.state.allUsersMap && this.state.allUsersMap[userId]) {
            return this.state.allUsersMap[userId];
        }
        
        // Chercher dans les membres du salon
        const container = this.elements.membersList;
        if (container) {
            const item = container.querySelector(`.member-item[data-user-id="${userId}"]`);
            if (item) {
                return {
                    id: userId,
                    username: item.dataset.username,
                    display_name: item.querySelector('.member-name')?.textContent,
                    role: item.dataset.role || 'member'
                };
            }
        }
        
        // Retourner l'utilisateur courant si c'est lui
        if (this.state.user?.id === userId) {
            return this.state.user;
        }
        
        return null;
    },
    
        // Envoyer un message avec Optimistic UI et support Retry
    sendMessage: async function() {
        const nowSec = Math.floor(Date.now() / 1000);
        const muteUntil = this.state && this.state.muteUntil ? this.state.muteUntil : 0;
        if (muteUntil && muteUntil - nowSec > 0) {
            this.showNotification('Vous êtes mute. Attendez la fin du compte à rebours.', 'error');
            return;
        }
        if (this.state.editingMessageId) {
            this.sendEditMessage();
            return;
        }
        
        const content = this.elements.messageInput?.value.trim();
        const currentAttachments = [...this.state.attachments]; // Copie des fichiers
        
        // 4. File-only send: Allow if content is empty but attachments exist
        if (!content && currentAttachments.length === 0) {
            return;
        }
        
        if (!this.state.currentChannel) {
            this.showNotification('Sélectionnez un canal', 'error');
            return;
        }
        
        if (!this.socket || !this.state.isConnected) {
            this.showNotification('Connexion en cours...', 'info');
            return;
        }
        
        // Optimistic UI START
        const clientId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const now = new Date().toISOString();
        
        // MARQUER COMME EN COURS pour protéger le brouillon
        // Si on change de canal pendant l'envoi, on ne veut pas effacer le brouillon
        this.state.pendingMessages[this.state.currentChannel.id] = true;
        
        // SAUVEGARDER LE BROUILLON MAINTENANT
        // Comme ça si on reload, le texte est là.
        this.saveDraft(this.state.currentChannel.id, content);
        
        // Préparer les fichiers locaux pour la prévisualisation
        const localAttachments = currentAttachments.map(att => ({
            id: 'temp-file-' + Date.now(),
            original_filename: att.file.name,
            type: att.file.type.startsWith('image/') ? 'image' : 'file',
            size: att.file.size,
            url: att.file.type.startsWith('image/') ? URL.createObjectURL(att.file) : null,
            is_local: true
        }));

        const optimisticMessage = {
            id: clientId,
            client_id: clientId,
            channel_id: this.state.currentChannel.id,
            content: content,
            author: this.state.user,
            created_at: now,
            attachments: localAttachments,
            pending: true,
            _originalFiles: currentAttachments.map(a => a.file)
        };

        // Rendu immédiat
        this.appendOptimisticMessage(optimisticMessage);
        
        // Nettoyage immédiat de l'input (UX rapide)
        this.clearComposer(); 
        
        // --- UPLOAD & SEND ---
        try {
            let serverAttachments = [];
            
            // Uploader les fichiers si nécessaire
            if (currentAttachments.length > 0) {
                serverAttachments = await this.uploadAttachments(currentAttachments);
            }
            
            const payload = {
                channel_id: optimisticMessage.channel_id,
                content: content,
                reply_to_id: this.state.replyTo?.id,
                attachments: serverAttachments,
                client_id: clientId
            };

            // Logique de Timeout (3s)
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT')), 3000)
            );

            const sendPromise = new Promise((resolve, reject) => {
                this.socket.emit('send_message', payload, (response) => {
                    if (response && (response.status === 'ok' || response.success)) {
                        resolve(response.data || response.message);
                    } else {
                        reject(new Error(response?.message || 'Erreur serveur'));
                    }
                });
            });

            // Course entre envoi et timeout
            const savedData = await Promise.race([sendPromise, timeoutPromise]);
            
            // Succès : Confirmation
            this.confirmOptimisticMessage(clientId, savedData);
            
            // Typing off
            if (this.socket) {
                this.socket.emit('typing', { channel_id: optimisticMessage.channel_id, typing: false });
            }

        } catch (error) {
            console.error('[KRONOS] Send error:', error);
            this.markMessageFailed(clientId, error.message === 'TIMEOUT');
        }
    },

    // Ajouter le message optimiste au DOM
    appendOptimisticMessage: function(message) {
        if (!this.state.messages[message.channel_id]) {
            this.state.messages[message.channel_id] = [];
        }
        this.state.messages[message.channel_id].push(message);

        const element = this.createMessageElement(message);
        if (element) {
            element.classList.add('message-pending');
            const meta = element.querySelector('.message-time');
            if (meta) {
                meta.innerHTML += ' <span class="status-icon">⏳</span>';
            }
            
            this.elements.messagesContainer?.appendChild(element);
            this.scrollToBottom();
        }
    },

    // Confirmer le message (retirer pending, mettre à jour ID)
    confirmOptimisticMessage: function(clientId, realMessage) {
        const channelId = realMessage.channel_id;
        
        // Retirer le flag "en cours"
        if (this.state.pendingMessages) {
            this.state.pendingMessages[channelId] = false;
        }

        // Mettre à jour le state
        if (this.state.messages[channelId]) {
            const idx = this.state.messages[channelId].findIndex(m => m.client_id === clientId || m.id === clientId);
            if (idx !== -1) {
                this.state.messages[channelId][idx] = realMessage;
            }
        }

        // Mettre à jour le DOM
        const element = document.querySelector(`[data-message-id="${clientId}"]`);
        if (element) {
            element.dataset.messageId = realMessage.id;
            element.classList.remove('message-pending');
            element.classList.remove('message-failed');
            const statusIcon = element.querySelector('.status-icon');
            if (statusIcon) statusIcon.remove();

            // CRITIQUE : Mettre à jour l'objet message attaché aux listeners
            // On ré-attache les listeners ou on met à jour la référence si possible
            this.attachMessageListeners(element, realMessage);
        }
        
        this.saveDraft(channelId, null);
    },

    // Marquer le message comme échoué
    markMessageFailed: function(clientId, isTimeout) {
        // Retirer le flag "en cours" pour permettre l'édition/suppression
        const channelId = this.state.dm.current?.channel?.id || this.state.currentChannel?.id;
        if (channelId && this.state.pendingMessages) {
            this.state.pendingMessages[channelId] = false;
        }

        const element = document.querySelector(`[data-message-id="${clientId}"]`);
        if (element) {
            element.classList.remove('message-pending');
            element.classList.add('message-failed');
            const statusIcon = element.querySelector('.status-icon');
            if (statusIcon) statusIcon.textContent = '⚠️';
            
            // Déterminer où ajouter le bouton retry (structure publique vs privée)
            let actionsContainer = element.querySelector('.message-header'); // Publique
            if (!actionsContainer) {
                actionsContainer = element.querySelector('.private-message-meta'); // Privée
            }
            
            if (actionsContainer && !actionsContainer.querySelector('.retry-btn')) {
                const retryBtn = document.createElement('button');
                retryBtn.className = 'retry-btn';
                retryBtn.textContent = isTimeout ? 'Réessayer ?' : 'Erreur';
                retryBtn.style.marginLeft = '8px';
                retryBtn.style.cursor = 'pointer';
                retryBtn.style.color = 'var(--error)';
                retryBtn.style.background = 'none';
                retryBtn.style.border = 'none';
                retryBtn.style.fontSize = '0.8rem';
                
                retryBtn.onclick = async (e) => {
                    e.stopPropagation();
                    
                    // Récupérer le message depuis le DOM ou le state
                    // Pour les messages privés, on doit peut-être chercher ailleurs
                    let msg = null;
                    if (this.state.messages[channelId]) {
                        msg = this.state.messages[channelId].find(m => m.id === clientId);
                    }
                    
                    // Si pas trouvé dans state (ex: optimiste non sauvegardé), on essaie de reconstruire depuis le DOM ou un cache temporaire
                    // Pour simplifier, on suppose qu'on a besoin du contenu.
                    // Si c'est un message privé, on peut récupérer le contenu du DOM
                    let content = '';
                    if (msg) {
                        content = msg.content;
                    } else {
                        // Fallback DOM
                        const bubble = element.querySelector('.message-content, .private-message-bubble');
                        if (bubble) content = bubble.textContent;
                    }

                    if (content || (msg && msg._originalFiles)) {
                        // Restaurer le contenu
                        const inputEl = element.classList.contains('private-message') ? this.elements.privateMessageInput : this.elements.messageInput;
                        
                        if (inputEl) {
                            inputEl.value = content || '';
                            inputEl.focus();
                        }

                        // Restaurer les fichiers si possible
                        if (msg && msg._originalFiles && msg._originalFiles.length > 0) {
                            this.state.attachments = msg._originalFiles.map(file => ({
                                file: file,
                                id: 'att-' + Date.now() + Math.random(),
                                preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
                            }));
                            this.renderAttachmentPreview();
                        }
                        
                        // Supprimer le message échoué
                        element.remove();
                        
                        // Réessayer l'envoi
                        if (element.classList.contains('private-message')) {
                            this.sendPrivateMessage();
                        } else {
                            await this.sendMessage();
                        }
                    }
                };
                actionsContainer.appendChild(retryBtn);
            }
        }
    },
    
    // Éditer un message - compatible DM
    editMessage: function(message) {
        if (!message) return;
        
        // Annuler toute réponse en cours
        this.state.replyTo = null;
        this.updateReplyPreview();
        
        const isDM = !!(this.state.dm?.current && (message.channel_id === this.state.dm.current?.channel?.id));
        const inputEl = isDM ? this.elements.privateMessageInput : this.elements.messageInput;
        const btnEl = isDM ? this.elements.privateSendBtn : this.elements.sendBtn;
        if (inputEl) {
            inputEl.value = message.content || '';
            inputEl.focus();
        }
        
        this.state.editingMessageId = message.id;
        
        if (inputEl) {
            inputEl.placeholder = 'Modifier le message...';
        }
        
        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.style.display = isDM ? 'none' : 'flex';
        }
        if (this.elements.privateCancelEditBtn) {
            this.elements.privateCancelEditBtn.style.display = isDM ? 'flex' : 'none';
        }
        
        // Changer le bouton d'envoi pour indiquer le mode édition
        if (btnEl) {
            btnEl.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
            btnEl.title = 'Valider les modifications';
        }
        
        this.showNotification('Mode édition - Modifiez et validez', 'info');
    },
    
    // Envoyer l'édition d'un message (public ou DM)
    sendEditMessage: function() {
        const isDM = !!(this.state.dm?.current && this.state.currentChannel?.id === this.state.dm.current?.channel?.id);
        const inputEl = isDM ? this.elements.privateMessageInput : this.elements.messageInput;
        const content = inputEl ? inputEl.value.trim() : '';
        const messageId = this.state.editingMessageId;
        
        if (!content || !messageId) {
            console.warn('[KRONOS] Tentative d\'édition invalide (contenu ou ID manquant)');
            this.cancelEdit();
            return;
        }
        
        console.log(`[KRONOS] Émission socket "edit_message" pour l'ID: ${messageId}`);
        // Utiliser l'événement edit_message au lieu de send_message
        this.socket.emit('edit_message', {
            message_id: messageId,
            content: content
        });
        
        this.cancelEdit();
    },
    
    // Annuler l'édition (réinitialise l'input correct)
    cancelEdit: function() {
        this.state.editingMessageId = null;
        
        if (this.elements.messageInput) {
            this.elements.messageInput.placeholder = 'Tapez votre message...';
        }
        if (this.elements.privateMessageInput) {
            this.elements.privateMessageInput.placeholder = 'Votre message...';
        }
        if (this.elements.messageInput) this.elements.messageInput.value = '';
        if (this.elements.privateMessageInput) this.elements.privateMessageInput.value = '';
        
        if (this.elements.sendBtn) {
            this.elements.sendBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
            `;
            this.elements.sendBtn.title = 'Envoyer';
        }
        if (this.elements.privateSendBtn) {
            this.elements.privateSendBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
            `;
            this.elements.privateSendBtn.title = 'Envoyer';
        }
        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.style.display = 'none';
        }
        if (this.elements.privateCancelEditBtn) {
            this.elements.privateCancelEditBtn.style.display = 'none';
        }
    },
    
    // Uploader les pièces jointes
    uploadAttachments: async function(attachmentsList = null) {
        const filesToProcess = attachmentsList || this.state.attachments;
        const uploadedFiles = [];
        
        for (const fileData of filesToProcess) {
            if (fileData.uploaded) {
                uploadedFiles.push(fileData);
                continue;
            }
            
            try {
                // Créer l'élément de progression dans l'aperçu
                const previewItem = document.querySelector(`.attachment-preview-item[data-id="${fileData.id}"]`);
                let progressBar = null;
                if (previewItem) {
                    progressBar = document.createElement('div');
                    progressBar.className = 'attachment-progress-bar';
                    progressBar.innerHTML = '<div class="progress-fill" style="width: 0%"></div>';
                    previewItem.appendChild(progressBar);
                }

                const formData = new FormData();
                formData.append('file', fileData.file);
                
                // Envoyer l'ID du canal pour organiser les fichiers
                if (this.state.currentChannel && this.state.currentChannel.id) {
                    formData.append('channel_id', this.state.currentChannel.id);
                } else if (this.state.dm && this.state.dm.current) {
                    if (this.state.dm.current.channel) {
                        formData.append('channel_id', this.state.dm.current.channel.id);
                    } else if (this.state.dm.current.user || this.state.dm.current.other_user) {
                         const targetUser = this.state.dm.current.user || this.state.dm.current.other_user;
                         if (targetUser && targetUser.id) {
                             formData.append('dm_target_user_id', targetUser.id);
                         }
                    }
                }
                
                const response = await new Promise((resolve, reject) => {
                    let retryCount = 0;
                    const maxRetries = 3;

                    const attemptUpload = () => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', '/api/upload');
                        
                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable && progressBar) {
                                const percent = Math.round((e.loaded / e.total) * 100);
                                const fill = progressBar.querySelector('.progress-fill');
                                if (fill) fill.style.width = `${percent}%`;
                            }
                        };
                        
                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(JSON.parse(xhr.responseText));
                            } else {
                                if (retryCount < maxRetries) {
                                    retryCount++;
                                    console.log(`[KRONOS] Tentative de reconnexion ${retryCount}/${maxRetries}...`);
                                    setTimeout(attemptUpload, 1000 * retryCount); // Backoff exponentiel simple
                                } else {
                                    reject(new Error(xhr.statusText || 'Échec de l\'upload après plusieurs tentatives'));
                                }
                            }
                        };
                        
                        xhr.onerror = () => {
                            if (retryCount < maxRetries) {
                                retryCount++;
                                setTimeout(attemptUpload, 1000 * retryCount);
                            } else {
                                reject(new Error('Erreur réseau persistante'));
                            }
                        };
                        
                        xhr.send(formData);
                    };

                    attemptUpload();
                });
                
                // Succès de l'upload
                if (progressBar) progressBar.remove();
                
                const data = response;
                if (data.channel_id && this.state.dm.current && !this.state.dm.current.channel) {
                    this.state.dm.current.channel = { id: data.channel_id };
                }

                uploadedFiles.push({
                    id: data.file_id || data.file?.id,
                    url: data.url || data.file?.url,
                    type: data.type || data.file?.type,
                    filename: data.filename || data.file?.filename,
                    size: data.size || data.file?.size,
                    uploaded: true
                });
            } catch (error) {
                console.error('[KRONOS] Erreur upload:', error);
                this.showNotification(`Erreur lors de l'upload de ${fileData.file.name}: ${error.message}`, 'error');
                // Marquer comme échoué pour reprise
                fileData.error = true;
                const previewItem = document.querySelector(`.attachment-preview-item[data-id="${fileData.id}"]`);
                if (previewItem) {
                    previewItem.classList.add('upload-failed');
                    const progress = previewItem.querySelector('.attachment-progress-bar');
                    if (progress) progress.innerHTML = '<span class="upload-retry-hint">Échec - Cliquez pour réessayer</span>';
                    
                    previewItem.onclick = () => {
                        previewItem.classList.remove('upload-failed');
                        if (progress) progress.remove();
                        this.uploadAttachments([fileData]);
                    };
                }
            }
        }
        
        return uploadedFiles;
    },
    
    // Gérer la sélection de fichiers
    handleFileSelect: function(files) {
        const newAttachments = Array.from(files).map(file => ({
            file: file,
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            name: file.name,
            size: file.size,
            type: this.getFileType(file),
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
            uploaded: false
        }));
        
        this.state.attachments = [...this.state.attachments, ...newAttachments];
        this.renderAttachmentPreview();
        
        // Focus sur l'input texte (Demande UX)
        if (this.elements.messageInput) {
            this.elements.messageInput.focus();
        }
    },
    
    // Déterminer le type de fichier
    getFileType: function(file) {
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('video/')) return 'video';
        if (file.type.startsWith('audio/')) return 'audio';
        return 'file';
    },
    
    // Obtenir l'icône pour le type de fichier
    getFileIcon: function(type) {
        const icons = {
            image: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            video: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
            audio: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
            file: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        };
        return icons[type] || icons.file;
    },
    
    // Formater la taille du fichier
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },
    
    // Supprimer une pièce jointe
    removeAttachment: function(id) {
        this.state.attachments = this.state.attachments.filter(a => a.id !== id);
        this.renderAttachmentPreview();
    },
    
    // Afficher l'aperçu des pièces jointes
    renderAttachmentPreview: function() {
        const containers = [];
        const main = document.getElementById('attachments-preview');
        const priv = document.getElementById('private-attachments-preview');
        if (main) containers.push(main);
        if (priv) containers.push(priv);
        if (containers.length === 0) return;
        
        if (this.state.attachments.length === 0) {
            containers.forEach(c => { c.innerHTML = ''; c.style.display = 'none'; });
            return;
        }
        
        const html = this.state.attachments.map(att => `
            <div class="attachment-preview-item" data-id="${att.id}">
                <div class="attachment-preview-content">
                    ${att.preview ? 
                        `<div class="attachment-image-preview" style="background-image: url('${att.preview}')"></div>` :
                        `<div class="attachment-icon">${this.getFileIcon(att.type)}</div>`
                    }
                </div>
                <div class="attachment-preview-info">
                    <span class="attachment-name" title="${this.escapeHtml(att.name)}">${this.escapeHtml(att.name.substring(0, 20))}${att.name.length > 20 ? '...' : ''}</span>
                    <span class="attachment-size">${this.formatFileSize(att.size)}</span>
                </div>
                <button class="attachment-remove" onclick="KRONOS.removeAttachment('${att.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        `).join('');
        containers.forEach(c => { c.style.display = 'block'; c.innerHTML = html; });
    },
    
    // Nettoyer le composeur après envoi
    clearComposer: function() {
        this.state.attachments = [];
        this.renderAttachmentPreview();
        
        if (this.elements.messageInput) {
            this.elements.messageInput.value = '';
            this.elements.messageInput.style.height = 'auto';
        }
        
        this.state.replyTo = null;
        this.updateReplyPreview();
        
        // Réinitialiser le input file
        const fileInput = document.getElementById('message-file-input');
        if (fileInput) fileInput.value = '';
    },
    
    // Débuter une réponse
    startReply: function(message) {
        if (!message) return;
        
        this.state.replyTo = message;
        this.updateReplyPreview();
        this.elements.messageInput?.focus();
    },
    
    // Mettre à jour l'aperçu de réponse
    updateReplyPreview: function() {
        const preview = this.elements.replyPreview;
        if (!preview) return;
        
        if (this.state.replyTo) {
            preview.style.display = 'flex';
            const authorEl = preview.querySelector('.reply-author');
            const textEl = preview.querySelector('.reply-text');
            if (authorEl) authorEl.textContent = this.state.replyTo.author?.display_name || 'Utilisateur';
            if (textEl) textEl.textContent = this.state.replyTo.content?.substring(0, 50) || '';
        } else {
            preview.style.display = 'none';
        }
    },
    
    // Annuler la réponse
    cancelReply: function() {
        this.state.replyTo = null;
        this.updateReplyPreview();
    },
    
    // ============================================
    // GESTION DES PANNEAUX
    // ============================================
    
    togglePanel: function(panelName) {
        console.log('[KRONOS] togglePanel:', panelName);
        
        const panels = {
            'members': this.elements.membersPanel,
            'files': this.elements.filesPanel,
            'profile': this.elements.profilePanel
        };
        
        const panel = panels[panelName];
        if (!panel) return;
        
        const isOpen = panel.classList.contains('open');
        
        if (isOpen) {
            this.closePanel(panelName);
        } else {
            this.closeAllPanels();
            this.openPanel(panelName);
        }
    },
    
    openPanel: function(panelName) {
        const panels = {
            'members': this.elements.membersPanel,
            'files': this.elements.filesPanel,
            'profile': this.elements.profilePanel
        };
        
        const panel = panels[panelName];
        if (!panel) return;
        
        this.closeAllPanels();
        panel.classList.add('open');
        panel.style.transform = 'translateX(0)';
        
        if (panelName === 'files') {
            // S'ABONNER aux mises à jour temps réel des fichiers
            if (this.socket) {
                this.socket.emit('subscribe_file_updates', { subscribe: true });
                console.log('[KRONOS] Abonné aux mises à jour de fichiers');
            }
            
            // Optimisation: ne recharger l'historique que si nécessaire (changement de canal ou liste vide)
            const currentChannelId = this.state.currentChannel?.id;
            const shouldReload = !this.state.filesLoadedChannelId || 
                                this.state.filesLoadedChannelId !== currentChannelId ||
                                !this.elements.filesList || 
                                this.elements.filesList.children.length === 0;
            
            if (shouldReload) {
                // Charger l'historique et ENSUITE charger les fichiers en attente
                this.loadFileHistory().then(() => {
                    // Après que loadFileHistory a fini, charger les fichiers en attente
                    this.loadPendingFiles();
                });
            } else {
                // Si pas de rechargement complet, juste vérifier les fichiers en attente
                this.loadPendingFiles();
            }
        }
    },
    
    closePanel: function(panelName) {
        const panels = {
            'members': this.elements.membersPanel,
            'files': this.elements.filesPanel,
            'profile': this.elements.profilePanel
        };
        
        const panel = panels[panelName];
        if (panel) {
            panel.classList.remove('open');
            
            if (panel.classList.contains('right')) {
                panel.style.transform = 'translateX(100%)';
            } else {
                panel.style.transform = 'translateX(-100%)';
            }
            
            // Se désabonner des mises à jour temps réel des fichiers quand le panneau se ferme
            if (panelName === 'files' && this.socket) {
                this.socket.emit('subscribe_file_updates', { subscribe: false });
                console.log('[KRONOS] Désabonné des mises à jour de fichiers');
            }
        }
    },
    
    // Charger les fichiers en attente dans le panneau
    loadPendingFiles: function() {
        if (this.state.pendingFiles.length === 0) {
            return;
        }
        
        console.log('[KRONOS] Chargement de', this.state.pendingFiles.length, 'fichiers en attente');
        
        const filesList = document.getElementById('files-list');
        if (!filesList) return;
        
        // Vérifier si le panneau a été complètement chargé (pas en état de chargement)
        const loadingState = filesList.querySelector('.files-loading');
        if (loadingState) {
            console.log('[KRONOS] Panneau encore en chargement, stockage des fichiers pour plus tard');
            return; // Le panneau n'est pas prêt, garder les fichiers en attente
        }
        
        // Récupérer les IDs des fichiers déjà présents dans le DOM
        const existingFileIds = new Set();
        filesList.querySelectorAll('.file-item').forEach(item => {
            existingFileIds.add(item.dataset.fileId);
        });
        
        // Filtrer les fichiers qui ne sont pas déjà dans le DOM ET qui appartiennent au channel courant
        const currentChannelId = this.state.currentChannel?.id;
        const filesToAdd = this.state.pendingFiles.filter(file => 
            !existingFileIds.has(file.id) && 
            (!file.channel_id || !currentChannelId || file.channel_id === currentChannelId)
        );
        
        if (filesToAdd.length === 0) {
            console.log('[KRONOS] Tous les fichiers en attente sont déjà présents');
            this.state.pendingFiles = [];
            return;
        }
        
        // Retirer l'état vide s'il existe
        const emptyState = filesList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
        
        // Vérifier si un conteneur grid existe, sinon le créer
        let filesGrid = filesList.querySelector('.files-grid');
        if (!filesGrid) {
            // Créer le conteneur grid
            filesGrid = document.createElement('div');
            filesGrid.className = 'files-grid';
            filesList.appendChild(filesGrid);
        }
        
        // Créer les éléments pour les fichiers en attente en utilisant renderFileItem
        const fragment = document.createDocumentFragment();
        
        filesToAdd.forEach((file, index) => {
            // Préparer les données du fichier avec size_formatted si nécessaire
            const fileData = {
                ...file,
                size_formatted: file.size_formatted || this.formatBytes(file.size || 0)
            };
            
            const fileItemHtml = this.renderFileItem(fileData);
            if (fileItemHtml) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = fileItemHtml;
                const fileItem = tempDiv.firstElementChild;
                
                if (fileItem) {
                    // Ajouter l'animation d'entrée avec délai progressif
                    fileItem.style.opacity = '0';
                    fileItem.style.transform = 'translateY(-10px)';
                    fileItem.style.transition = `all 0.3s ease ${index * 0.05}s`;
                    fragment.appendChild(fileItem);
                }
            }
        });
        
        // Insérer tous les éléments au début du grid
        filesGrid.insertBefore(fragment, filesGrid.firstChild);
        
        // Appliquer l'animation
        requestAnimationFrame(() => {
            filesGrid.querySelectorAll('.file-item').forEach(item => {
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            });
        });
        
        // Mettre à jour le compteur
        this.updateFilesCount();
        
        // Vider la liste des fichiers en attente (seulement ceux qui ont été ajoutés)
        this.state.pendingFiles = this.state.pendingFiles.filter(file => 
            existingFileIds.has(file.id) || !filesToAdd.find(f => f.id === file.id)
        );
        
        console.log('[KRONOS] Fichiers en attente traités, restants:', this.state.pendingFiles.length);
    },
    
    closeAllPanels: function() {
        console.log('[KRONOS] Fermeture de tous les panneaux');
        
        // Vérifier si le panneau de fichiers est ouvert avant de le fermer
        const filesPanel = this.elements.filesPanel;
        const wasFilesPanelOpen = filesPanel && filesPanel.classList.contains('open');
        
        ['members', 'files', 'profile'].forEach(name => {
            const panels = {
                'members': this.elements.membersPanel,
                'files': this.elements.filesPanel,
                'profile': this.elements.profilePanel
            };
            const panel = panels[name];
            if (panel) {
                panel.classList.remove('open');
                if (panel.classList.contains('right')) {
                    panel.style.transform = 'translateX(100%)';
                } else {
                    panel.style.transform = 'translateX(-100%)';
                }
            }
        });
        
        // Fermer également le panneau de fichiers privés
        this.closePrivateFilesPanel();
        
        // Se désabonner des mises à jour temps réel si le panneau de fichiers était ouvert
        if (wasFilesPanelOpen && this.socket) {
            this.socket.emit('subscribe_file_updates', { subscribe: false });
            console.log('[KRONOS] Désabonné des mises à jour de fichiers (closeAllPanels)');
        }
    },
    
    // ============================================
    // HISTORIQUE DES FICHIERS
    // ============================================
    
    loadFileHistory: async function() {
        if (!this.elements.filesList) {
            console.error('[KRONOS] Élément filesList non trouvé');
            return Promise.resolve();
        }

        // VERIFICATION DE CONTEXTE : Si on est en DM, on doit afficher les fichiers du canal PUBLIC (previousChannel)
        // ou refuser d'afficher. Le panneau "Fichiers" principal est réservé aux fichiers PUBLICS.
        let channelIdToLoad = this.state.currentChannel?.id;
        
        if (this.state.dm.current) {
             console.log('[KRONOS] loadFileHistory appelé en mode DM. Tentative de chargement du canal public.');
             if (this.state.previousChannel) {
                 channelIdToLoad = this.state.previousChannel.id;
             } else {
                 this.elements.filesList.innerHTML = `
                    <div class="empty-state" style="padding: 40px;">
                        <p style="color: var(--text-muted);">Veuillez sélectionner un canal public pour voir l'historique des fichiers publics.</p>
                    </div>
                 `;
                 return Promise.resolve();
             }
        }
        
        this.elements.filesList.innerHTML = `
            <div class="files-loading" style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: var(--text-secondary); margin-top: var(--space-md);">Chargement des fichiers...</p>
            </div>
        `;
        
        try {
            console.log('[KRONOS] Chargement de l\'historique des fichiers pour:', channelIdToLoad);
            const channelParam = channelIdToLoad ? `?channel_id=${encodeURIComponent(channelIdToLoad)}` : '';
            const response = await fetch(`/api/files/history${channelParam}`);
            
            console.log('[KRONOS] Réponse API fichiers:', response.status);
            
            if (!response.ok) {
                console.error('[KRONOS] Erreur HTTP:', response.status);
                this.elements.filesList.innerHTML = '<div class="no-files"><span>Erreur de chargement</span></div>';
                return Promise.resolve();
            }
            
            const data = await response.json();
            console.log('[KRONOS] Données fichiers reçues:', data);
            
            // Enregistrer l'ID du salon chargé
            this.state.filesLoadedChannelId = this.state.currentChannel?.id;
            
            let files = data.files || [];
            
            // FILTRAGE STRICT CÔTÉ CLIENT
            // S'assurer que les fichiers appartiennent bien au canal demandé
            if (channelIdToLoad) {
                files = files.filter(f => f.channel_id === channelIdToLoad);
            }
            
            if (files.length === 0) {
                this.elements.filesList.innerHTML = `
                    <div class="empty-state" style="padding: 40px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <p style="color: var(--text-muted); margin-top: var(--space-md);">Aucun fichier partagé</p>
                    </div>
                `;
                return Promise.resolve();
            }
            
            // Affichage direct avec Download et prévisualisation
            this.elements.filesList.innerHTML = `
                <div class="files-grid">
                    ${files.map(file => this.renderFileItem(file)).join('')}
                </div>
            `;

            // Ajouter les écouteurs pour les aperçus
            this.elements.filesList.querySelectorAll('.file-preview-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const fileId = btn.dataset.fileId;
                    const fileType = btn.dataset.fileType;
                    this.previewFile(fileId, fileType);
                });
            });

            // Clic sur l'item pour les images et vidéos
            this.elements.filesList.querySelectorAll('.file-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    // Ne pas ouvrir si on a cliqué sur un bouton
                    if (e.target.closest('.file-actions')) return;

                    const fileId = item.dataset.fileId;
                    const fileType = item.dataset.fileType;
                    if (fileType === 'image' || fileType === 'video') {
                        this.previewFile(fileId, fileType);
                    }
                });
            });
            
            return Promise.resolve();
            
        } catch (error) {
            console.error('[KRONOS] Erreur chargement fichiers:', error);
            this.elements.filesList.innerHTML = '<div class="no-files"><span>Erreur de chargement</span></div>';
            return Promise.resolve();
        }
    },
    
    loadDMConversations: async function() {
        try {
            const response = await fetch('/api/dm/conversations');
            if (!response.ok) return;
            const data = await response.json();
            this.state.dm.conversations = data.conversations || [];
            this.renderDMConversations();
        } catch (e) {}
    },
    
    renderDMConversations: function() {
        const list = this.elements.privateConversationsList;
        if (!list) return;
        list.innerHTML = '';
        if (!this.state.dm.conversations || this.state.dm.conversations.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="padding: 16px;">
                    <p style="color: var(--text-muted);">Aucune conversation privée</p>
                </div>
            `;
            return;
        }
        const frag = document.createDocumentFragment();
        this.state.dm.conversations.forEach((conv) => {
            const item = document.createElement('div');
            item.className = 'private-conversation-item';
            item.dataset.channelId = conv.channel.id;
            const lastText = conv.last_message?.content ? this.truncateText(conv.last_message.content, 40) : 'Aucun message';
            const avatar = conv.other_user?.avatar_url || conv.other_user?.avatar || '/static/icons/default_avatar.svg';
            const name = conv.other_user?.display_name || conv.other_user?.username || 'Utilisateur';
            const time = conv.last_message?.created_at ? this.formatTime(conv.last_message.created_at) : '';
            const unread = conv.unread_count || 0;
            const mentionClass = conv.has_mention_unread ? ' mention' : '';
            item.innerHTML = `
                <div class="private-conv-avatar-wrapper">
                    <img class="private-conv-avatar" src="${avatar}" alt="">
                    <span class="private-conv-online-indicator" style="display:none;"></span>
                </div>
                <div class="private-conv-info">
                    <div class="private-conv-name">${this.escapeHtml(name)}</div>
                    <div class="private-conv-last-message">${this.escapeHtml(lastText)}</div>
                </div>
                <div class="private-conv-meta">
                    <span class="private-conv-time">${time}</span>
                    ${unread > 0 ? `<span class="private-conv-unread${mentionClass}">${unread}</span>` : ''}
                </div>
            `;
            item.addEventListener('click', () => this.openDMConversation(conv));
            frag.appendChild(item);
        });
        list.appendChild(frag);
        this.updatePrivateUnreadBadge();
    },
    
    openDMConversation: function(conv) {
        if (!conv) return;
        
        console.log('[KRONOS] Opening DM with:', conv.other_user?.username);
        
        // Fermer tous les panneaux principaux pour éviter les superpositions
        this.closeAllPanels();
        
        // Sauvegarder le canal précédent (seulement si on n'est pas déjà dans un DM)
        // Cela permet de revenir au canal public/admin quand on ferme le DM
        if (!this.state.dm.current && this.state.currentChannel) {
            this.state.previousChannel = this.state.currentChannel;
        }
        
        // 1. SAUVEGARDE DU BROUILLON PRÉCÉDENT
        if (this.state.currentChannel) {
             // Cas 1: On était déjà dans un DM (changement de DM)
             if (this.state.dm.current && this.elements.privateMessageInput) {
                 this.saveDraft(this.state.currentChannel.id, this.elements.privateMessageInput.value);
             } 
             // Cas 2: On était dans un canal public (ouverture d'un DM depuis le public)
             else if (!this.state.dm.current && this.elements.messageInput) {
                 this.saveDraft(this.state.currentChannel.id, this.elements.messageInput.value);
             }
        }

        // 2. NETTOYAGE EXPLICITE DE L'INPUT PRIVÉ (Anti-Contamination)
        // C'est critique pour éviter que le texte du canal précédent n'apparaisse dans le DM
        if (this.elements.privateMessageInput) {
            this.elements.privateMessageInput.value = '';
        }

        // CORRECTION: Quitter l'ancien canal pour éviter la fuite de messages
        // Cela empêche de recevoir les messages du canal précédent
        if (this.state.currentChannel && this.socket && this.state.isConnected) {
            console.log('[KRONOS] Quitter le canal précédent (avant DM):', this.state.currentChannel.id);
            this.socket.emit('leave_channel', { channel_id: this.state.currentChannel.id });
        }
        
        // 3. RESTAURATION DU BROUILLON DM (Si existe)
        if (this.elements.privateMessageInput) {
             const draft = conv.channel ? this.loadDraft(conv.channel.id) : '';
             this.elements.privateMessageInput.value = draft || '';
        }
        
        // Réinitialiser les pièces jointes
        this.state.attachments = [];
        this.renderAttachmentPreview();
        
        this.state.dm.current = conv;
        this.state.currentChannel = conv.channel || null;
        // Ne PAS ajouter la classe 'open' pour garder la liste en pleine largeur (640px)
        // this.elements.privatePanel?.classList.add('open');
        this.updatePrivateHeader(conv);
        const chatArea = document.querySelector('.private-chat-area');
        const chatActions = document.querySelector('.private-chat-actions');
        if (chatArea) chatArea.style.display = 'flex';
        if (chatActions) chatActions.style.display = 'flex';
        // Focus input de composition pour démarrer rapidement
        if (this.elements.privateMessageInput) {
            this.elements.privateMessageInput.focus();
        }
        // Si le canal existe, rejoindre et charger les messages
        if (conv.channel?.id) {
            if (this.socket && this.state.isConnected) {
                this.socket.emit('join_channel', { channel_id: conv.channel.id });
            }
            this.loadMessages(conv.channel.id).then(() => {
                this.renderPrivateMessages();
            });
        } else {
            // Aucun canal: afficher un état vide prêt à démarrer
            if (this.elements.privateMessagesContainer) {
                this.elements.privateMessagesContainer.innerHTML = `
                    <div class="private-empty-state">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <h3>Démarrez la conversation</h3>
                        <p>Écrivez un message pour créer la conversation privée.</p>
                    </div>
                `;
            }
        }
        // Remettre à zéro le compteur local d'inlus et MAJ badge
        try {
            const idx = this.state.dm.conversations.findIndex(c => c.channel?.id === conv.channel?.id);
            if (idx !== -1) {
                this.state.dm.conversations[idx].unread_count = 0;
                this.state.dm.conversations[idx].has_mention_unread = false;
                this.renderDMConversations();
            }
        } catch (_) {}
        this.updatePrivateUnreadBadge();
    },
    
    closePrivateConversation: function() {
        this.state.dm.current = null;
        this.elements.privatePanel?.classList.remove('open');
        // Fermer le panneau fichiers si ouvert
        this.closePrivateFilesPanel();
        
        if (this.elements.privateMessagesContainer) {
            this.elements.privateMessagesContainer.innerHTML = `
                <div class="private-empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <h3>Aucune conversation</h3>
                    <p>Choisissez un utilisateur pour démarrer un échange privé.</p>
                </div>
            `;
        }
        
        const chatArea = document.querySelector('.private-chat-area');
        const chatActions = document.querySelector('.private-chat-actions');
        if (chatArea) chatArea.style.display = 'none';
        if (chatActions) chatActions.style.display = 'none';

        // RESTAURATION DU CANAL PRÉCÉDENT
        // C'est CRITIQUE pour éviter que currentChannel reste sur le DM fermé
        // et que les messages du DM s'affichent dans la vue principale
        if (this.state.previousChannel) {
            console.log('[KRONOS] Restauration du canal précédent:', this.state.previousChannel.name);
            const prev = this.state.previousChannel;
            this.state.previousChannel = null; // Reset
            this.selectChannel(prev);
        } else {
            // Si pas de précédent, on reset juste le currentChannel pour éviter les fuites
            // Mais idéalement on devrait rediriger vers un canal par défaut
            this.state.currentChannel = null;
            if (this.elements.channelNameDisplay) {
                this.elements.channelNameDisplay.textContent = 'Sélectionnez un canal';
            }
            if (this.elements.messagesContainer) {
                this.elements.messagesContainer.innerHTML = '';
            }
        }
    },
    
    updatePrivateHeader: function(conv) {
        if (!conv) return;
        const u = conv.other_user;
        if (this.elements.privateChatAvatar) {
            this.elements.privateChatAvatar.src = u?.avatar || '/static/icons/default_avatar.svg';
        }
        if (this.elements.privateChatUsername) {
            this.elements.privateChatUsername.textContent = u?.display_name || u?.username || '';
        }
        const info = document.getElementById('private-chat-user-info');
        if (info) info.style.display = 'flex';
    },
    
    renderPrivateMessages: function() {
        const container = this.elements.privateMessagesContainer;
        const channelId = this.state.dm.current?.channel?.id;
        if (!container || !channelId) return;
        const msgs = this.state.messages[channelId] || [];
        container.innerHTML = '';
        const frag = document.createDocumentFragment();
        msgs.forEach((m) => {
            const div = document.createElement('div');
            div.className = 'private-message ' + (m.author?.id === this.state.user?.id ? 'mine' : 'theirs');
            div.dataset.messageId = m.id;
            const avatar = m.author?.avatar || '/static/icons/default_avatar.svg';
            const name = m.author?.display_name || m.author?.username || '';
            const time = this.formatTime(m.created_at);
            div.innerHTML = `
                <img class="private-message-avatar" src="${avatar}" alt="">
                <div class="private-message-content">
                    <div class="private-message-author">${this.escapeHtml(name)}</div>
                    <div class="private-message-bubble">${this.escapeHtml(m.content || '')}</div>
                    <div class="private-message-meta">
                        <span class="private-message-time">${time}</span>
                    </div>
                </div>
            `;
            
            // Actions DM: réutiliser la barre publique (message-actions-bar)
            const canEdit = (m.author?.id === this.state.user?.id) || (this.state.user?.role === 'admin' || this.state.user?.role === 'supreme' || this.state.user?.is_admin);
            if (canEdit) {
                const bar = document.createElement('div');
                bar.className = 'message-actions-bar';
                bar.innerHTML = `
                    <button class="action-btn-edit" title="Modifier">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn-delete" title="Supprimer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                `;
                div.appendChild(bar);
                bar.querySelector('.action-btn-edit')?.addEventListener('click', (e) => { e.stopPropagation(); this.editMessage(m); });
                bar.querySelector('.action-btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); this.deleteMessage(m.id); });
            }
            
            // Ajouter les pièces jointes au message privé
            if (m.attachments && m.attachments.length > 0) {
                const attachmentsHtml = this.renderAttachmentsHtml(m.attachments);
                const contentDiv = div.querySelector('.private-message-content');
                if (contentDiv) {
                    // Insérer après la bulle de message
                    const bubble = contentDiv.querySelector('.private-message-bubble');
                    if (bubble) {
                        bubble.insertAdjacentHTML('afterend', attachmentsHtml);
                    } else {
                        contentDiv.insertAdjacentHTML('beforeend', attachmentsHtml);
                    }
                }
            }

            const avatarEl = div.querySelector('.private-message-avatar');
            const authorEl = div.querySelector('.private-message-author');
            if (avatarEl) {
                avatarEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (m.author) this.showUserProfile(m.author);
                });
            }
            if (authorEl) {
                authorEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (m.author) this.showUserProfile(m.author);
                });
            }
            frag.appendChild(div);
        });
        container.appendChild(frag);
        container.scrollTop = container.scrollHeight;
    },
    
    sendPrivateMessage: function() {
        const nowSec = Math.floor(Date.now() / 1000);
        const muteUntil = this.state && this.state.muteUntil ? this.state.muteUntil : 0;
        if (muteUntil && muteUntil - nowSec > 0) {
            this.showNotification('Vous êtes mute. Attendez la fin du compte à rebours.', 'error');
            return;
        }
        const input = this.elements.privateMessageInput;
        if (!input) return;
        // En mode édition DM → valider l'édition au lieu d'envoyer un nouveau message
        if (this.state.editingMessageId) {
            this.sendEditMessage();
            return;
        }
        const text = (input.value || '').trim();
        
        // 4. File-only send: Allow if content is empty but attachments exist
        const hasAttachments = this.state.attachments && this.state.attachments.length > 0;
        if (!text && !hasAttachments) return;
        
        const conv = this.state.dm.current;
        if (!conv) return;
        
        const payload = { content: text, attachments: [] };
        
        // Uploader les pièces jointes si présentes
        if (hasAttachments) {
            this.uploadAttachments().then((uploaded) => {
                payload.attachments = uploaded || [];
                this._emitPrivateMessage(payload, conv, input);
            }).catch(() => {
                this.showNotification('Erreur upload pièces jointes', 'error');
            });
            return;
        }
        this._emitPrivateMessage(payload, conv, input);
    },
    
    _emitPrivateMessage: function(payload, conv, inputEl) {
        if (conv.channel?.id) {
            payload.channel_id = conv.channel.id;
        } else if (conv.other_user?.id) {
            payload.dm_target_user_id = conv.other_user.id;
        }

        // Optimistic UI START
        const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        payload.client_id = tempId;

        // 3. Système de brouillon (draft)
        // SAUVEGARDER LE BROUILLON MAINTENANT pour qu'il persiste jusqu'à l'ACK
        if (conv.channel?.id) {
             this.saveDraft(conv.channel.id, payload.content);
             // Marquer comme pending pour protéger le brouillon
             if (!this.state.pendingMessages) this.state.pendingMessages = {};
             this.state.pendingMessages[conv.channel.id] = true;
        }

        if (this.socket && this.state.isConnected) {
            // Setup timeout
            const ackTimeout = setTimeout(() => {
                this.markMessageFailed(tempId, true); // true for timeout/retry
            }, 3000); // 3 seconds timeout

            // Utiliser le callback d'ACK pour confirmer
            this.socket.emit('send_message', payload, (response) => {
                 clearTimeout(ackTimeout); // Clear timeout on ACK
                 if (response && (response.status === 'ok' || response.success)) {
                     // Succès : Confirmer et vider le brouillon
                     if (conv.channel?.id) {
                         this.confirmOptimisticMessage(tempId, response.data || { ...payload, id: response.message_id || tempId });
                     }
                 } else {
                     // Échec
                     this.markMessageFailed(tempId, false);
                 }
            });
        }
        
        // Message optimiste: afficher tout de suite dans la conversation
        const tempMessage = {
            id: tempId,
            client_id: tempId,
            author: this.state.user,
            content: payload.content,
            created_at: new Date().toISOString(),
            pending: true,
            attachments: payload.attachments || [],
            _originalFiles: payload.attachments // Pour le retry
        };

        // Ajouter au state global des messages si channel_id existe
        if (payload.channel_id) {
            if (!this.state.messages[payload.channel_id]) {
                this.state.messages[payload.channel_id] = [];
            }
            this.state.messages[payload.channel_id].push(tempMessage);
        }
        
        // Ajouter dans l'aperçu de la liste
        if (this.state.dm.current) {
            this.state.dm.current.last_message = tempMessage;
            this.renderDMConversations();
        }
        
        // Ajouter dans le DOM privé
        if (this.elements.privateMessagesContainer) {
            // CORRECTION: Supprimer l'état vide s'il est présent
            const emptyState = this.elements.privateMessagesContainer.querySelector('.private-empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            const div = document.createElement('div');
            div.className = 'private-message mine private-message-sending message-pending';
            div.dataset.messageId = tempId;
            const avatar = this.state.user?.avatar || '/static/icons/default_avatar.svg';
            const name = this.state.user?.display_name || this.state.user?.username || '';
            const time = this.formatTime(tempMessage.created_at);
            
            div.innerHTML = `
                <img class="private-message-avatar" src="${avatar}" alt="">
                <div class="private-message-content">
                    <div class="private-message-author">${this.escapeHtml(name)}</div>
                    <div class="private-message-bubble">${this.escapeHtml(tempMessage.content || '')}</div>
                    <div class="private-message-meta">
                        <span class="private-message-time">${time}</span>
                        <span class="status-icon">⏳</span>
                    </div>
                </div>
            `;
            
            // Ajouter les pièces jointes au message temporaire
            if (payload.attachments && payload.attachments.length > 0) {
                const attachmentsHtml = this.renderAttachmentsHtml(payload.attachments);
                const contentDiv = div.querySelector('.private-message-content');
                if (contentDiv) {
                    const bubble = contentDiv.querySelector('.private-message-bubble');
                    if (bubble) {
                        bubble.insertAdjacentHTML('afterend', attachmentsHtml);
                    }
                }
            }
            
            this.elements.privateMessagesContainer.appendChild(div);
            this.elements.privateMessagesContainer.scrollTop = this.elements.privateMessagesContainer.scrollHeight;
            
            // Actions pour le message optimiste : réutiliser la barre publique
            const bar = document.createElement('div');
            bar.className = 'message-actions-bar';
            bar.innerHTML = `
                <button class="action-btn-edit" title="Modifier">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="action-btn-delete" title="Supprimer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            `;
            div.appendChild(bar);
            bar.querySelector('.action-btn-edit')?.addEventListener('click', (e) => { e.stopPropagation(); this.editMessage(tempMessage); });
            bar.querySelector('.action-btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); this.deleteMessage(tempId); });
        }
        
        // Nettoyer l'input MAIS garder le brouillon (via saveDraft fait plus haut)
        if (inputEl) inputEl.value = '';
        this.clearComposer();
    },
    
    handleDMConversationCreated: function(data) {
        if (!data || !data.channel) return;
        const existing = this.state.dm.conversations.find(c => c.channel?.id === data.channel.id);
        if (!existing) {
            this.state.dm.conversations.unshift({
                channel: data.channel,
                other_user: data.other_user,
                last_message: null,
                unread_count: 1
            });
            this.renderDMConversations();
        }
        // Si une conversation temporaire (sans canal) est ouverte avec cet utilisateur, lier le canal et ouvrir
        const current = this.state.dm.current;
        if (current && !current.channel && current.other_user?.id === data.other_user?.id) {
            current.channel = data.channel;
            this.state.currentChannel = data.channel;
            // S'abonner au salon pour recevoir les mises à jour en direct
            if (this.socket && this.state.isConnected) {
                this.socket.emit('join_channel', { channel_id: data.channel.id });
            }
            this.openDMConversation(current);
        }
    },
    
    handleDMConversationUpdated: function(data) {
        if (!data || !data.channel) return;
        const isMyMsg = data.last_message?.author?.id === this.state.user?.id;
        const mentionedIds = data.last_message?.mentioned_user_ids || [];
        const isMention = Array.isArray(mentionedIds) && this.state.user ? mentionedIds.includes(this.state.user.id) : false;
        const idx = this.state.dm.conversations.findIndex(c => c.channel && c.channel.id === data.channel.id);
        if (idx !== -1) {
            // Mettre à jour la conversation existante
            const wasOpen = this.state.dm.current?.channel?.id === data.channel.id;
            const conv = this.state.dm.conversations[idx];
            conv.last_message = data.last_message || conv.last_message;
            if (!wasOpen && !isMyMsg) {
                conv.unread_count = (conv.unread_count || 0) + 1;
                if (isMention) conv.has_mention_unread = true;
            }
            // Remonter en tête
            this.state.dm.conversations.splice(idx, 1);
            this.state.dm.conversations.unshift(conv);
            this.renderDMConversations();
        } else {
            // Créer la conversation si absente (ex: premier message reçu)
            const unread = !isMyMsg ? 1 : 0;
            this.state.dm.conversations.unshift({
                channel: data.channel,
                other_user: data.other_user,
                last_message: data.last_message || null,
                unread_count: unread,
                has_mention_unread: unread && isMention ? true : false
            });
            this.renderDMConversations();
        }
    },
    
    // startPrivateConversation: défini plus bas (version consolidée)
    
    // Afficher un élément de fichier
    renderFileItem: function(file) {
        const filename = file.original_filename || file.filename;
        const fileType = file.type || 'document';
        const icon = this.getFileIcon(fileType);
        const size = this.formatBytes(file.size || 0);
        const date = this.formatDate(file.created_at);
        const fileId = file.id;
        const fileUrl = `/uploads/files/${fileId}`;
        
        // Récupérer le nom de l'uploader si disponible
        const uploaderName = file.uploader?.display_name || file.uploader?.username || null;

        // Déterminer les types qui supportent l'aperçu
        const hasPreview = ['image', 'video', 'audio', 'document'].includes(fileType);

        return `
            <div class="file-item" data-file-id="${fileId}" data-file-type="${fileType}">
                <div class="file-icon ${fileType}">
                    ${fileType === 'image' ?
                        `<div class="file-thumbnail" style="background-image: url(${fileUrl})"></div>` :
                        fileType === 'video' || fileType === 'audio' ?
                        `<div class="file-type-badge">${fileType}</div>${icon}` :
                        icon
                    }
                </div>
                <div class="file-info">
                    <div class="file-name" title="${this.escapeHtml(filename)}">${this.escapeHtml(this.truncateText(filename, 25))}</div>
                    <div class="file-meta">
                        <span class="file-size">${size}</span>
                        <span class="file-date">${date}</span>
                        ${uploaderName ? `<span class="file-author">par ${this.escapeHtml(uploaderName)}</span>` : ''}
                    </div>
                </div>
                <div class="file-actions">
                    ${hasPreview ? `
                        <button class="file-preview-btn" data-file-id="${fileId}" data-file-type="${fileType}" title="Aperçu">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                    ` : ''}
                    <a href="${fileUrl}"
                       download="${this.escapeHtml(filename)}"
                       class="file-download-btn"
                       title="Télécharger: ${this.escapeHtml(filename)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </a>
                </div>
            </div>
        `;
    },
    
    // Prévisualiser un fichier
    previewFile: function(fileId, fileType) {
        const fileUrl = `/uploads/files/${fileId}`;
        let previewContent = '';
        let title = '';

        if (fileType === 'image') {
            previewContent = `<img src="${fileUrl}" alt="Aperçu" class="preview-image">`;
            title = 'Aperçu de l\'image';
        } else if (fileType === 'video') {
            previewContent = `
                <video controls class="preview-video" autoplay>
                    <source src="${fileUrl}" type="video/mp4">
                    Votre navigateur ne supporte pas la lecture vidéo.
                </video>
            `;
            title = 'Lecture vidéo';
        } else if (fileType === 'audio') {
            previewContent = `
                <div style="text-align: center; padding: 20px; width: 400px;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent); margin-bottom: 20px;">
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                    </svg>
                    <audio controls class="preview-audio" style="width: 100%;">
                        <source src="${fileUrl}" type="audio/mpeg">
                        Votre navigateur ne supporte pas la lecture audio.
                    </audio>
                </div>
            `;
            title = 'Lecture audio';
        } else if (fileType === 'document') {
            // Pour les documents, ouvrir dans un nouvel onglet
            window.open(fileUrl, '_blank');
            return;
        }

        // Créer ou réutiliser la modale de prévisualisation
        let previewModal = document.getElementById('file-preview-modal');
        if (!previewModal) {
            previewModal = document.createElement('div');
            previewModal.id = 'file-preview-modal';
            previewModal.className = 'modal-overlay';
            document.body.appendChild(previewModal);
        }

        previewModal.innerHTML = `
            <div class="preview-container" onclick="event.stopPropagation()">
                <button class="preview-close" onclick="KRONOS.closeFilePreview()">×</button>
                <div class="preview-content">
                    ${previewContent}
                </div>
            </div>
        `;

        previewModal.classList.add('open');
        previewModal.style.display = 'flex';

        // Fermer avec Escape
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeFilePreview();
            }
        };
        document.addEventListener('keydown', escapeHandler);
        previewModal._escapeHandler = escapeHandler;

        // Fermer en cliquant sur l'overlay
        previewModal.onclick = () => this.closeFilePreview();
    },

    // Fermer l'aperçu de fichier
    closeFilePreview: function() {
        const previewModal = document.getElementById('file-preview-modal');
        if (previewModal) {
            previewModal.classList.remove('open');
            previewModal.style.display = 'none';

            // Arrêter les médias en cours
            const video = previewModal.querySelector('video');
            const audio = previewModal.querySelector('audio');
            if (video) video.pause();
            if (audio) audio.pause();

            // Retirer le gestionnaire Escape
            if (previewModal._escapeHandler) {
                document.removeEventListener('keydown', previewModal._escapeHandler);
                previewModal._escapeHandler = null;
            }
        }
    },
    
    // FICHIERS DE CONVERSATION PRIVÉE
    togglePrivateFilesPanel: function() {
        const panel = document.getElementById('private-files-panel');
        if (!panel) return;
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
            this.closePrivateFilesPanel();
        } else {
            // Fermer les autres panneaux avant d'ouvrir celui-ci
            this.closeAllPanels();
            this.openPrivateFilesPanel();
        }
    },
    openPrivateFilesPanel: function() {
        const panel = document.getElementById('private-files-panel');
        const list = document.getElementById('private-files-list');
        if (!panel || !list) return;
        panel.style.display = 'block';
        const channelId = this.state.dm.current?.channel?.id;
        if (!channelId) {
            list.innerHTML = `
                <div class="empty-state" style="padding: 24px;">
                    <p style="color: var(--text-muted);">Aucune conversation sélectionnée</p>
                </div>
            `;
        } else {
            this.loadPrivateFileHistory(channelId);
        }
        panel.classList.add('open');
        document.getElementById('close-private-files')?.addEventListener('click', () => this.closePrivateFilesPanel());
    },
    closePrivateFilesPanel: function() {
        const panel = document.getElementById('private-files-panel');
        if (!panel) return;
        panel.classList.remove('open');
        panel.style.display = 'none';
    },
    loadPrivateFileHistory: async function(channelId) {
        const list = document.getElementById('private-files-list');
        if (!list) return;
        list.innerHTML = `
            <div class="files-loading" style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: var(--text-secondary); margin-top: var(--space-md);">Chargement des fichiers de la conversation...</p>
            </div>
        `;
        try {
            const response = await fetch(`/api/files/history?channel_id=${encodeURIComponent(channelId)}`);
            if (!response.ok) {
                list.innerHTML = '<div class="empty-state" style="padding: 24px;"><span>Erreur de chargement</span></div>';
                return;
            }
            const data = await response.json();
            let files = data.files || [];
            
            // FILTRAGE STRICT CÔTÉ CLIENT
            if (channelId) {
                files = files.filter(f => f.channel_id === channelId);
            }
            
            if (files.length === 0) {
                list.innerHTML = `
                    <div class="empty-state" style="padding: 24px;">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <p style="color: var(--text-muted); margin-top: var(--space-sm);">Aucun fichier partagé dans cette conversation</p>
                    </div>
                `;
                return;
            }
            list.innerHTML = `
                <div class="files-grid">
                    ${files.map(file => this.renderFileItem(file)).join('')}
                </div>
            `;
            list.querySelectorAll('.file-preview-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const fileId = btn.dataset.fileId;
                    const fileType = btn.dataset.fileType;
                    this.previewFile(fileId, fileType);
                });
            });
        } catch (e) {
            list.innerHTML = '<div class="empty-state" style="padding: 24px;"><span>Erreur de chargement</span></div>';
        }
    },
    
    // Tronquer le texte
    truncateText: function(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    },
    
    // Obtenir l'icône对应的类型
    getFileIcon: function(type) {
        const icons = {
            'image': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            'video': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
            'audio': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
            'document': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
        };
        return icons[type] || icons['document'];
    },
    
    // Éditer un message (version principale, compatible public + DM)
    editMessage: function(message) {
        if (!message) return;
        
        // Annuler toute réponse en cours
        this.state.replyTo = null;
        this.updateReplyPreview();
        
        const isDM = !!(this.state.dm?.current && (message.channel_id === this.state.dm.current?.channel?.id));
        const inputEl = isDM ? this.elements.privateMessageInput : this.elements.messageInput;
        const btnEl = isDM ? this.elements.privateSendBtn : this.elements.sendBtn;
        
        if (inputEl) {
            inputEl.value = message.content || '';
            inputEl.focus();
            inputEl.placeholder = 'Modifier le message...';
        }
        
        this.state.editingMessageId = message.id;
        
        // Afficher la croix d'annulation au bon endroit
        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.style.display = isDM ? 'none' : 'flex';
        }
        if (this.elements.privateCancelEditBtn) {
            this.elements.privateCancelEditBtn.style.display = isDM ? 'flex' : 'none';
        }
        
        if (btnEl) {
            btnEl.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
            btnEl.title = 'Valider les modifications';
        }
        
        this.showNotification('Mode édition - Modifiez et validez', 'info');
    },
    
    // Supprimer un message
    deleteMessage: async function(messageId) {
        if (!messageId) return;
        
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce message ?')) return;
        
        try {
            console.log(`[KRONOS] Tentative de suppression du message: ${messageId}`);
            const response = await fetch(`/api/messages/${messageId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const data = await response.json();
                console.error(`[KRONOS] Erreur suppression (${response.status}):`, data.error);
                this.showNotification(data.error || 'Erreur lors de la suppression', 'error');
            } else {
                console.log(`[KRONOS] Message supprimé avec succès: ${messageId}`);
            }
        } catch (error) {
            console.error('[KRONOS] Erreur réseau lors de la suppression:', error);
            this.showNotification('Erreur réseau lors de la suppression', 'error');
        }
    },
    
    // Ajouter/retirer une réaction
    toggleReaction: async function(button) {
        if (!button || !button.dataset) return;
        
        const messageId = button.dataset.messageId;
        const emoji = button.dataset.emoji;
        
        if (!messageId || !emoji) return;
        
        try {
            await fetch(`/api/messages/${messageId}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji })
            });
        } catch (error) {
            console.error('[KRONOS] Erreur lors de la réaction:', error);
        }
    },
    
    // Afficher le picker d'emojis
    showEmojiPicker: function(element) {
        if (!element) return;
        
        const emojis = ['😀', '😂', '🥰', '😎', '🤔', '👍', '👎', '❤️', '🎉', '🔥', '💯', '✨'];
        
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        picker.innerHTML = emojis.map(e => 
            `<button class="emoji-btn" data-emoji="${e}">${e}</button>`
        ).join('');
        
        picker.style.cssText = `
            position: absolute;
            bottom: 100%;
            right: 0;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: var(--space-sm);
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 4px;
            z-index: 1000;
        `;
        
        element.parentElement.appendChild(picker);
        
        picker.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const messageId = element.dataset.messageId;
                this.toggleReaction({ dataset: { messageId, emoji: btn.dataset.emoji } });
                picker.remove();
            });
        });
        
        setTimeout(() => {
            document.addEventListener('click', function close(e) {
                if (!picker.contains(e.target)) {
                    picker.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 0);
    },
    
    // Ouvrir une pièce jointe avec visionneuse intégrée
    openAttachment: async function(fileId) {
        if (!fileId) return;
        
        try {
            const response = await fetch(`/api/files/${fileId}`);
            if (!response.ok) {
                this.showNotification('Fichier non trouvé', 'error');
                return;
            }
            
            const data = await response.json();
            const file = data.file;
            
            this.openFileViewer(file);
        } catch (error) {
            console.error('[KRONOS] Erreur lors de l\'ouverture du fichier:', error);
            // Fallback: ouvrir dans un nouvel onglet
            window.open(`/uploads/files/${fileId}`, '_blank');
        }
    },
    
    // Ouvrir la visionneuse de fichiers
    openFileViewer: function(file) {
        const viewer = document.getElementById('file-viewer');
        const viewerContent = document.getElementById('viewer-content');
        const viewerTitle = document.getElementById('viewer-title');
        
        if (!viewer || !viewerContent || !viewerTitle) {
            // Fallback si la visionneuse n'existe pas
            window.open(file.url, '_blank');
            return;
        }
        
        const overlay = document.getElementById('modal-overlay');
        
        // Définir le titre
        viewerTitle.textContent = file.original_filename;
        
        // Construire le contenu selon le type de fichier
        let content = '';
        
        if (file.is_image || file.type === 'image') {
            // Image avec navigation
            content = `
                <div class="viewer-image-container">
                    <img src="${file.url}" alt="${this.escapeHtml(file.original_filename)}" class="viewer-image">
                </div>
                <div class="viewer-actions">
                    <a href="${file.url}" download="${this.escapeHtml(file.original_filename)}" class="btn-secondary viewer-action-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Télécharger
                    </a>
                    <button class="btn-secondary viewer-action-btn" onclick="window.open('${file.url}', '_blank')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                        Ouvrir
                    </button>
                </div>
            `;
        } else if (file.is_video || file.type === 'video') {
            // Lecteur vidéo
            content = `
                <div class="viewer-video-container">
                    <video src="${file.url}" controls class="viewer-video" autoplay>
                        Votre navigateur ne prend pas en charge la lecture vidéo.
                    </video>
                </div>
                <div class="viewer-actions">
                    <a href="${file.url}" download="${this.escapeHtml(file.original_filename)}" class="btn-secondary viewer-action-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Télécharger
                    </a>
                </div>
            `;
        } else if (file.is_audio || file.type === 'audio') {
            // Lecteur audio
            content = `
                <div class="viewer-audio-container">
                    <div class="audio-cover">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18V5l12-2v13"/>
                            <circle cx="6" cy="18" r="3"/>
                            <circle cx="18" cy="16" r="3"/>
                        </svg>
                    </div>
                    <div class="audio-info">
                        <span class="audio-filename">${this.escapeHtml(file.original_filename)}</span>
                        <span class="audio-filesize">${this.formatFileSize(file.size)}</span>
                    </div>
                    <audio src="${file.url}" controls class="viewer-audio">
                        Votre navigateur ne prend pas en charge la lecture audio.
                    </audio>
                </div>
                <div class="viewer-actions">
                    <a href="${file.url}" download="${this.escapeHtml(file.original_filename)}" class="btn-secondary viewer-action-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Télécharger
                    </a>
                </div>
            `;
        } else {
            // Fichier générique avec informations
            content = `
                <div class="viewer-generic-container">
                    <div class="generic-file-icon">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </div>
                    <div class="generic-file-info">
                        <span class="generic-filename">${this.escapeHtml(file.original_filename)}</span>
                        <span class="generic-filesize">${this.formatFileSize(file.size)}</span>
                        <span class="generic-filetype">${file.type.toUpperCase()}</span>
                    </div>
                </div>
                <div class="viewer-actions">
                    <a href="${file.url}" download="${this.escapeHtml(file.original_filename)}" class="btn-secondary viewer-action-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Télécharger
                    </a>
                </div>
            `;
        }
        
        viewerContent.innerHTML = content;
        
        // Afficher l'overlay
        overlay.style.display = 'flex';
        viewer.style.display = 'block';
    },
    
    // Afficher le menu contextuel - Version améliorée pour gérer messages ET membres
    showContextMenu: function(e, data) {
        if (!e || !data) return;
        
        const menu = this.elements.contextMenu;
        if (!menu) return;
        
        // Déterminer si c'est un message ou un profil de membre
        const isMessage = data.id && data.content !== undefined;
        const author = data.author || data;
        const targetId = author?.id;
        
        let html = `
            <div class="context-header">${this.escapeHtml(author?.display_name || author?.username || 'Inconnu')}</div>
        `;
        
        const isSelf = targetId === this.state.user?.id;
        const isAdminUser = this.state.user?.role === 'admin' || this.state.user?.role === 'supreme';
        
        // ============================================
        // UTILISER LES DONNÉES LES PLUS RÉCENTES DEPUIS LE STATE
        // ============================================
        // Récupérer les données utilisateur les plus récentes depuis le map
        const latestUser = this.state.allUsersMap?.[targetId] || author || {};
        const targetRole = latestUser.role || author?.role || 'member';
        
        const isTargetSupreme = targetRole === 'supreme';
        
        // ============================================
        // VÉRIFIER L'ÉTAT DE L'UTILISATEUR POUR BOUTONS DYNAMIQUES
        // ============================================
        
        // Vérifier si l'utilisateur est banni ou shadowbanni
        const isBanned = this.state.bannedUsers?.some(u => u.id === targetId);
        const isShadowbanned = this.state.shadowbannedUsers?.some(u => u.id === targetId);
        
        // Vérifier le rôle de l'utilisateur cible (utiliser les données récentes)
        const isTargetAdmin = targetRole === 'admin' || targetRole === 'moderator' || targetRole === 'supreme';
        
        // Texte dynamique pour les boutons
        const banText = isBanned || isShadowbanned ? 'Débannir' : 'Bannir';
        const banAction = (isBanned || isShadowbanned) ? 'unban' : 'ban';
        const shadowbanText = isShadowbanned ? 'Retirer shadowban' : 'Shadowban';
        const shadowbanAction = isShadowbanned ? 'unshadowban' : 'shadowban';
        const adminText = isTargetAdmin ? 'Rétrograder' : 'Promouvoir Admin';
        const adminAction = isTargetAdmin ? 'unadmin' : 'promote';
        
        // ============================================
        // ACTIONS POUR LES MESSAGES
        // ============================================
        
        if (isMessage) {
            // Actions pour ses propres messages
            if (isSelf) {
                html += `
                    <button class="context-item" data-action="edit" data-id="${data.id}">Modifier</button>
                    <button class="context-item danger" data-action="delete" data-id="${data.id}">Supprimer</button>
                `;
            }
            
            // Actions admin pour les messages des autres
            if (!isSelf && isAdminUser && !isTargetSupreme) {
                html += '<div class="context-divider"></div>';
                html += `<button class="context-item" data-action="kick" data-id="${targetId}">Expulser</button>`;
                html += `<button class="context-item" data-action="${banAction}" data-id="${targetId}">${banText}</button>`;
                html += `<button class="context-item" data-action="${shadowbanAction}" data-id="${targetId}">${shadowbanText}</button>`;
                
                // Bouton admin uniquement pour les non-supreme
                if (author?.role !== 'supreme') {
                    html += `<button class="context-item" data-action="${adminAction}" data-id="${targetId}">${adminText}</button>`;
                }
            }
        }
        
        // ============================================
        // ACTIONS POUR LES PROFILS DE MEMBRES
        // ============================================
        
        else {
            // Boutons disponibles pour tous (sauf soi-même)
            if (!isSelf) {
                html += '<div class="context-divider"></div>';
                html += `<button class="context-item" data-action="profile" data-id="${targetId}">Voir le profil</button>`;
                html += `<button class="context-item" data-action="message" data-id="${targetId}">Envoyer un message</button>`;
            }
            
            // Actions admin pour les membres
            if (isAdminUser && !isSelf && !isTargetSupreme) {
                html += '<div class="context-divider"></div>';
                html += `<button class="context-item" data-action="kick" data-id="${targetId}">Expulser (Kick)</button>`;
                html += `<button class="context-item" data-action="${banAction}" data-id="${targetId}">${banText}</button>`;
                html += `<button class="context-item" data-action="${shadowbanAction}" data-id="${targetId}">${shadowbanText}</button>`;
                html += `<button class="context-item" data-action="${adminAction}" data-id="${targetId}">${adminText}</button>`;
            }
            
            // Indicateur pour les Supreme Admin
            if (isTargetSupreme) {
                html += '<div class="context-divider"></div>';
                html += `<span class="context-info">Admin Suprême - Actions limitées</span>`;
            }
        }
        
        menu.innerHTML = html;
        menu.style.display = 'block';
        menu.style.position = 'fixed';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.style.zIndex = '1000';
        
        // Ajouter les écouteurs pour les boutons
        menu.querySelectorAll('.context-item').forEach(item => {
            item.addEventListener('click', () => {
                this.handleContextAction(item.dataset.action, item.dataset.id);
                this.hideContextMenu();
            });
        });
        
        // Fermer le menu en cliquant ailleurs
        this.hideContextMenuOnClick = (e) => {
            if (!menu.contains(e.target)) {
                this.hideContextMenu();
                document.removeEventListener('click', this.hideContextMenuOnClick);
            }
        };
        setTimeout(() => document.addEventListener('click', this.hideContextMenuOnClick), 0);
    },
    
    // Cacher le menu contextuel
    hideContextMenu: function() {
        if (this.elements.contextMenu) {
            this.elements.contextMenu.style.display = 'none';
        }
    },
    
    
    // Gérer les actions du menu contextuel
    handleContextAction: async function(action, id) {
        if (!action) return;
        
        try {
            switch (action) {
                // Actions pour les messages
                case 'edit':
                    const message = this.state.messages[this.state.currentChannel?.id]?.find(m => m.id === id);
                    if (message) this.editMessage(message);
                    break;
                    
                case 'delete':
                    await this.deleteMessage(id);
                    break;
                
                // Actions pour les profils de membres
                case 'profile':
                    const userForProfile = this.state.allUsersMap?.[id] || this.findMemberById(id);
                    if (userForProfile) {
                        this.showUserProfile(userForProfile);
                    }
                    break;
                    
                case 'message':
                    this.startPrivateConversation(id);
                    break;
                    
                // Actions admin
                case 'kick':
                    const kickUrlCtx = prompt('URL de redirection (laissez vide pour /login):', '/login');
                    if (kickUrlCtx === null) return;
                    const kickReasonCtx = prompt('Raison de l\'expulsion (optionnel):', '');
                    if (kickReasonCtx === null) kickReasonCtx = '';
                    await this.kickUser(id, kickUrlCtx, kickReasonCtx);
                    break;
                    
                case 'ban':
                    const banReason = prompt('Raison du bannissement (laisser vide pour aucune raison):', '');
                    await this.banUser(id, banReason);
                    break;
                    
                case 'unban':
                    await this.unbanUser(id);
                    break;
                    
                case 'shadowban':
                    await this.toggleShadowban(id);
                    break;
                    
                case 'unshadowban':
                    await this.toggleShadowban(id);
                    break;
                    
                case 'promote':
                    await this.promoteUser(id);
                    break;
                    
                case 'demote':
                    await this.demoteUser(id);
                    break;
                    
                case 'unadmin':
                    await this.unadminUser(id);
                    break;
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    // Actions de modération
    kickUser: async function(userId, redirectUrl, reason) {
        if (!userId) {
            console.warn('[KRONOS] kickUser appelé sans userId');
            return;
        }

        const url = redirectUrl || '/login';
        console.log('[KRONOS] kickUser appelé pour userId:', userId, 'url:', url, 'raison:', reason);

        try {
            const response = await fetch(`/api/admin/users/${userId}/kick`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    redirect_url: url,
                    reason: reason || ''
                })
            });

            console.log('[KRONOS] Kick response status:', response.status);

            if (response.ok) {
                const data = await response.json();
                this.showNotification(`Utilisateur expulsé vers ${url}`);
                console.log('[KRONOS] Utilisateur expulsé avec succès vers:', url);
            } else {
                const error = await response.json();
                console.error('[KRONOS] Erreur kick:', error);
                this.showNotification(error.error || 'Erreur lors de l\'expulsion', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur kick:', error);
            this.showNotification('Erreur de connexion lors de l\'expulsion', 'error');
        }
    },
    
    // Promouvoir un utilisateur en admin
    promoteUser: async function(userId) {
        if (!userId) return;
        
        try {
            const response = await fetch(`/api/admin/users/${userId}/promote?role=admin`, { method: 'POST' });
            if (response.ok) {
                this.showNotification('Utilisateur promu Admin');
                this.hideContextMenu();  // Fermer le menu après action
                this.loadMembers();  // Recharger la liste
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    muteUser: async function(userId, seconds) {
        if (!userId || !seconds) return;
        try {
            const response = await fetch(`/api/admin/users/${userId}/mute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seconds })
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                this.showNotification(data.message || 'Utilisateur mute');
            } else {
                this.showNotification(data.error || 'Erreur mute', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur mute:', error);
        }
    },
    
    unmuteUser: async function(userId) {
        if (!userId) return;
        try {
            const response = await fetch(`/api/admin/users/${userId}/unmute`, {
                method: 'POST'
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                this.showNotification(data.message || 'Mute retiré');
            } else {
                this.showNotification(data.error || 'Erreur unmute', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur unmute:', error);
        }
    },
    
    // Rétrograder un admin
    demoteUser: async function(userId) {
        if (!userId) return;
        
        try {
            const response = await fetch(`/api/admin/users/${userId}/demote`, { method: 'POST' });
            if (response.ok) {
                this.showNotification('Admin rétrogradé');
                this.hideContextMenu();  // Fermer le menu après action
                this.loadMembers();  // Recharger la liste
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    banUser: async function(userId, reason) {
        if (!userId) return;

        try {
            const response = await fetch(`/api/admin/users/${userId}/ban`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason || '' })
            });
            if (response.ok) {
                this.showNotification('Utilisateur banni');
                this.hideContextMenu();  // Fermer le menu après action
                this.loadMembers();  // Recharger la liste
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    // Débannir un utilisateur
    unbanUser: async function(userId) {
        if (!userId) return;
        
        try {
            const response = await fetch(`/api/admin/users/${userId}/unban`, { method: 'POST' });
            if (response.ok) {
                this.showNotification('Utilisateur débanni');
                this.hideContextMenu();  // Fermer le menu après action
                this.loadMembers();  // Recharger la liste
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    toggleShadowban: async function(userId) {
        if (!userId) return;
        
        try {
            const response = await fetch(`/api/admin/users/${userId}/shadowban`, { method: 'POST' });
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Statut shadowban modifié');
                this.hideContextMenu();  // Fermer le menu après action
                this.loadMembers();  // Recharger la liste
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    // Retirer les droits admin suprême
    unadminUser: async function(userId) {
        if (!userId) return;
        
        try {
            const response = await fetch(`/api/admin/users/${userId}/unadmin`, { method: 'POST' });
            if (response.ok) {
                this.showNotification('Droits Admin Suprême retirés');
                this.hideContextMenu();  // Fermer le menu après action
                this.loadMembers(); // Recharger la liste des membres
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    // Afficher le profil d'un utilisateur - Version enrichie
    showUserProfile: function(user) {
        console.log('[KRONOS] showUserProfile:', user?.username);
        
        if (!user || !user.id) {
            this.showNotification('Données utilisateur invalides', 'error');
            return;
        }
        
        let overlay = document.getElementById('profile-overlay');
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'profile-overlay';
            document.body.appendChild(overlay);
        }
        
        // Informations enrichies
        const joinDate = this.formatJoinDate(user.created_at);
        const lastSeen = this.formatLastSeen(user.last_seen);
        
        const roleTranslations = {
            'supreme': 'Admin Suprême',
            'admin': 'Administrateur',
            'moderator': 'Modérateur',
            'member': 'Membre'
        };
        const roleLabel = roleTranslations[user.role] || 'Membre';
        
        // Icône de rôle
        const roleIcons = {
            'supreme': '👑',
            'admin': '⭐',
            'moderator': '🛡️',
            'member': '👤'
        };
        const roleIcon = roleIcons[user.role] || '👤';
        
        const avatarUrl = user.avatar || '/static/icons/default_avatar.svg';
        const bannerUrl = user.banner || (this.state.user && this.state.user.id === user.id && this.state.user.banner) || null;
        const displayName = user.display_name || user.username || 'Utilisateur';
        const username = user.username || 'N/A';
        const isMuted = !!user.mute_until && Date.parse(user.mute_until) > Date.now();
        
        // Déterminer le statut en ligne
        const isOnline = this.state.onlineUsers.has(user.id);
        const statusText = isOnline ? 'En ligne' : lastSeen;
        const statusClass = isOnline ? 'online' : 'offline';
        
        overlay.innerHTML = `
            <div class="profile-modal" onclick="event.stopPropagation()">
                <div class="profile-modal-header">
                    ${bannerUrl ? `<div class="profile-modal-banner" data-banner-url="${bannerUrl}"></div>` : ''}
                    <button class="profile-modal-close" id="profile-modal-close-btn">×</button>
                    <div class="profile-modal-avatar">
                        <img src="${avatarUrl}" alt="Avatar de ${this.escapeHtml(displayName)}" onerror="this.src='/static/icons/default_avatar.svg'">
                    </div>
                    <div class="profile-status-indicator ${statusClass}"></div>
                </div>
                <div class="profile-modal-body">
                    <div class="profile-modal-name">${this.escapeHtml(displayName)}</div>
                    <div class="profile-modal-username">@${this.escapeHtml(username)}</div>
                    <div class="profile-modal-role ${user.role || 'member'}">
                        <span class="role-icon">${roleIcon}</span>
                        ${roleLabel}
                    </div>
                    ${user.bio ? `<div class="profile-modal-bio">${this.escapeHtml(user.bio)}</div>` : '<div class="profile-modal-bio" style="font-style: italic; color: var(--text-muted);">Aucune biographie</div>'}
                    
                    <!-- Informations supplémentaires -->
                    <div class="profile-modal-info">
                        <div class="info-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <span>Inscrit le ${joinDate}</span>
                        </div>
                        <div class="info-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            <span>${statusText}</span>
                        </div>
                        <div class="info-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            <span>ID: ${user.id}</span>
                        </div>
                    </div>
                    
                    <!-- Statistiques -->
                    <div class="profile-modal-stats">
                        <div class="profile-modal-stat">
                            <div class="profile-modal-stat-value">${roleIcon}</div>
                            <div class="profile-modal-stat-label">Rôle</div>
                        </div>
                        <div class="profile-modal-stat">
                            <div class="profile-modal-stat-value">${joinDate.split(' ')[0].replace(',', '')}</div>
                            <div class="profile-modal-stat-label">Inscrit</div>
                        </div>
                        <div class="profile-modal-stat">
                            <div class="profile-modal-stat-value">${isOnline ? '●' : '○'}</div>
                            <div class="profile-modal-stat-label">Statut</div>
                        </div>
                    </div>
                    
                    <!-- Actions possibles -->
                    <div class="profile-modal-actions">
                        ${user.id !== this.state.user?.id ? `
                            <button class="btn-action" data-user-id="${user.id}" data-action="message" title="Discuter en privé">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                </svg>
                                Discuter en privé
                            </button>
                        ` : ''}
                        
                        
                        <!-- Boutons Admin (visible uniquement pour les admins) -->
                        ${(this.state.user?.role === 'admin' || this.state.user?.role === 'supreme') && user.id !== this.state.user?.id ? `
                            <div class="profile-admin-actions">
                                ${user.role === 'supreme' ? `
                                    <button class="btn-action btn-action-unadmin" data-user-id="${user.id}" data-action="unadmin" title="Retirer droits Admin">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                                            <line x1="12" y1="2" x2="12" y2="12"/>
                                        </svg>
                                        Retirer Admin
                                    </button>
                                ` : (user.role === 'admin' || user.role === 'moderator') ? `
                                    <button class="btn-action btn-action-demote" data-user-id="${user.id}" data-action="demote" title="Retrograder en membre">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                            <path d="M2 17l10 5 10-5"/>
                                            <path d="M2 12l10 5 10-5"/>
                                        </svg>
                                        Retrograder
                                    </button>
                                ` : `
                                    <button class="btn-action btn-action-promote" data-user-id="${user.id}" data-action="promote" title="Promouvoir Admin">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                            <path d="M2 17l10 5 10-5"/>
                                            <path d="M2 12l10 5 10-5"/>
                                        </svg>
                                        Promouvoir
                                    </button>
                                `}
                                ${user.is_active === false || user.is_banned ? `
                                    <button class="btn-action btn-action-unban" data-user-id="${user.id}" data-action="unban" title="Débannir">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                            <circle cx="8.5" cy="7" r="4"/>
                                            <polyline points="17 11 19 13 23 9"/>
                                        </svg>
                                        Débannir
                                    </button>
                                ` : `
                                    <button class="btn-action btn-action-kick" data-user-id="${user.id}" data-action="kick" title="Expulser">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M18 6L6 18M6 6l12 12"/>
                                        </svg>
                                        Expulser
                                    </button>
                                    <button class="btn-action btn-action-ban" data-user-id="${user.id}" data-action="ban" title="Bannir">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                                        </svg>
                                        Bannir
                                    </button>
                                `}
                                ${isMuted ? `
                                    <button class="btn-action btn-action-unmute" data-user-id="${user.id}" data-action="unmute" title="Retirer le mute">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M9 9v6l-2 2V7l2 2z"/>
                                            <path d="M13 9v6a4 4 0 0 0 4 4"/>
                                            <line x1="3" y1="3" x2="21" y2="21"/>
                                        </svg>
                                        Démute
                                    </button>
                                ` : `
                                    <button class="btn-action btn-action-mute" data-user-id="${user.id}" data-action="mute" title="Mute temporaire">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M9 9v6l-2 2V7l2 2z"/>
                                            <path d="M13 9v6a4 4 0 0 0 4 4"/>
                                            <path d="M19 10a4 4 0 0 0-4-4"/>
                                        </svg>
                                        Mute
                                    </button>
                                `}
                                ${!user.is_shadowbanned ? `
                                    <button class="btn-action btn-action-shadowban" data-user-id="${user.id}" data-action="shadowban" title="Shadowban">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M17.5 6.5C17.5 6.5 19 8 19 10.5C19 13 17.5 15 15 15C12.5 15 11 13 11 11C11 8.5 12.5 6.5 15 6.5"/>
                                            <path d="M3 3L21 21"/>
                                            <path d="M9.5 9.5C9.5 9.5 8 11 8 13.5C8 16 9.5 18 12 18C14.5 18 16 16 16 13.5C16 11 14.5 9.5 12 9.5"/>
                                        </svg>
                                        Shadowban
                                    </button>
                                ` : `
                                    <button class="btn-action btn-action-unshadowban" data-user-id="${user.id}" data-action="unshadowban" title="Retirer shadowban">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M17.5 6.5C17.5 6.5 19 8 19 10.5C19 13 17.5 15 15 15"/>
                                            <path d="M9.5 9.5C9.5 9.5 8 11 8 13.5C8 16 9.5 18 12 18"/>
                                            <path d="M22 12c0 2-2 4-5 4"/>
                                            <path d="M2 12c0-2 2-4 5-4"/>
                                        </svg>
                                        De-shadowban
                                    </button>
                                `}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        const closeBtn = document.getElementById('profile-modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hideUserProfile();
            });
        }
        
        const bannerEl = overlay.querySelector('.profile-modal-banner');
        if (bannerEl && bannerUrl) {
            this.smartFillBanner(bannerEl, bannerUrl);
        }
        
        // Écouteurs pour les boutons du profil modal (actions principales)
        overlay.querySelectorAll('.profile-modal-actions .btn-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const userId = btn.dataset.userId;
                
                switch (action) {
                    case 'message':
                        this.startPrivateConversation(userId);
                        break;
                }
            });
        });
        
        // Écouteurs pour les boutons admin
        overlay.querySelectorAll('.profile-admin-actions .btn-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const userId = btn.dataset.userId;
                
                switch (action) {
                    case 'promote':
                        if (confirm('Promouvoir cet utilisateur au rang Admin ?')) {
                            this.promoteUser(userId);
                        }
                        break;
                    case 'demote':
                        if (confirm('Retrograder cet utilisateur au rang Membre ?')) {
                            this.demoteUser(userId);
                        }
                        break;
                    case 'kick':
                        const kickUrl = prompt('URL de redirection (laissez vide pour /login):', '/login');
                        if (kickUrl === null) {
                            console.log('[KRONOS] Kick annulé');
                            return;
                        }
                        const kickReason = prompt('Raison de l\'expulsion (optionnel):', '');
                        if (kickReason === null) kickReason = '';
                        this.kickUser(userId, kickUrl, kickReason);
                        break;
                    case 'unadmin':
                        if (confirm('Retirer les droits Admin Supreme a cet utilisateur ?')) {
                            this.unadminUser(userId);
                        }
                        break;
                    case 'ban':
                        const reason = prompt('Raison du bannissement (laisser vide pour aucune raison):');
                        this.banUser(userId, reason);
                        break;
                    case 'unban':
                        if (confirm('Debannir cet utilisateur ?')) {
                            this.unbanUser(userId);
                        }
                        break;
                    case 'shadowban':
                        this.toggleShadowban(userId);
                        break;
                    case 'unshadowban':
                        this.toggleShadowban(userId);
                        break;
                    case 'mute':
                        const minutesStr = prompt('Durée du mute en minutes:');
                        if (!minutesStr) break;
                        const minutes = parseInt(minutesStr, 10);
                        if (!Number.isFinite(minutes) || minutes <= 0) {
                            this.showNotification('Durée invalide', 'error');
                            break;
                        }
                        this.muteUser(userId, minutes * 60);
                        break;
                    case 'unmute':
                        if (confirm('Retirer le mute de cet utilisateur ?')) {
                            this.unmuteUser(userId);
                        }
                        break;
                }
            });
        });
        
        const closeOnClickOutside = (e) => {
            if (e.target === overlay) {
                this.hideUserProfile();
            }
        };
        
        if (this._profileOverlayClickHandler) {
            overlay.removeEventListener('click', this._profileOverlayClickHandler);
        }
        this._profileOverlayClickHandler = closeOnClickOutside;
        overlay.addEventListener('click', closeOnClickOutside);
        
        // Stocker l'ID de l'utilisateur affiché dans le profil
        this.state.profileOverlayUserId = user.id;
        this.state.profileOverlayUserData = user;
        
        overlay.classList.add('open');
        overlay.style.display = 'flex';
        
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler);
        }
        this._escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.hideUserProfile();
            }
        };
        document.addEventListener('keydown', this._escapeHandler);
    },
    
    startPrivateConversation: async function(targetUserId) {
        if (!targetUserId) return;
        try {
            const response = await fetch('/api/dm/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_user_id: targetUserId })
            });
            if (!response.ok) {
                const fallbackUser = this.state.profileOverlayUserData && this.state.profileOverlayUserData.id === targetUserId
                    ? this.state.profileOverlayUserData
                    : null;
                if (fallbackUser) {
                    const conv = {
                        channel: null,
                        other_user: {
                            id: fallbackUser.id,
                            username: fallbackUser.username,
                            display_name: fallbackUser.display_name,
                            avatar_url: fallbackUser.avatar_url
                        },
                        last_message: null,
                        unread_count: 0
                    };
                    this.openDMConversation(conv);
                    this.hideUserProfile();
                    this.closePanel('members');
                    return;
                } else {
                    const err = await response.json().catch(() => ({}));
                    this.showNotification(err.error || 'Impossible de démarrer la conversation', 'error');
                    return;
                }
            }
            const data = await response.json();
            const conv = {
                channel: data.channel,
                other_user: data.other_user,
                last_message: data.last_message || null,
                unread_count: 0
            };
            const existingIdx = this.state.dm.conversations.findIndex(c => c.channel && data.channel && c.channel.id === data.channel.id);
            if (existingIdx === -1) {
                console.log('[KRONOS] Nouvelle conversation créée, ajout à la liste:', conv);
                this.state.dm.conversations.unshift(conv);
                // Forcer le rendu immédiat de la liste
                requestAnimationFrame(() => {
                    this.renderDMConversations();
                });
            }
            
            // Rejoindre immédiatement le socket room pour ne rien rater
            if (data.channel && data.channel.id && this.socket && this.state.isConnected) {
                this.socket.emit('join_channel', { channel_id: data.channel.id });
            }
            
            this.openDMConversation(conv);
            this.hideUserProfile();
            this.closePanel('members');
        } catch (e) {
            const fallbackUser = this.state.profileOverlayUserData && this.state.profileOverlayUserData.id === targetUserId
                ? this.state.profileOverlayUserData
                : null;
            if (fallbackUser) {
                const conv = {
                    channel: null,
                    other_user: {
                        id: fallbackUser.id,
                        username: fallbackUser.username,
                        display_name: fallbackUser.display_name,
                        avatar_url: fallbackUser.avatar_url
                    },
                    last_message: null,
                    unread_count: 0
                };
                this.openDMConversation(conv);
                this.hideUserProfile();
                this.closePanel('members');
            } else {
                console.error('[KRONOS] startPrivateConversation error:', e);
                this.showNotification('Erreur réseau', 'error');
            }
        }
    },
    
    // Masquer le profil
    hideUserProfile: function() {
        const overlay = document.getElementById('profile-overlay');
        if (overlay) {
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }
        
        // Effacer l'ID de l'utilisateur affiché
        this.state.profileOverlayUserId = null;
        
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler);
            this._escapeHandler = null;
        }
    },
    
    // Déclencher le Panic Mode
    triggerPanic: function() {
        fetch('/api/panic/trigger', { method: 'POST' });
        window.location.replace(this.state.panicUrl);
    },
    
    // Upload de fichiers
    uploadFiles: async function(files) {
        if (!files || files.length === 0) return;
        
        const formData = new FormData();
        
        for (let file of files) {
            formData.append('file', file);
        }
        
        // Envoyer l'ID du canal pour organiser les fichiers
        if (this.state.currentChannel && this.state.currentChannel.id) {
            formData.append('channel_id', this.state.currentChannel.id);
        } else if (this.state.dm && this.state.dm.current) {
            // Si on a un canal DM
            if (this.state.dm.current.channel) {
                formData.append('channel_id', this.state.dm.current.channel.id);
            } 
            // Si c'est un NOUVEAU DM sans canal encore créé, on envoie l'ID de l'autre utilisateur
            else if (this.state.dm.current.user || this.state.dm.current.other_user) {
                 const targetUser = this.state.dm.current.user || this.state.dm.current.other_user;
                 if (targetUser && targetUser.id) {
                     formData.append('dm_target_user_id', targetUser.id);
                 }
            }
        }
        
        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification('Fichier uploadé avec succès');
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur lors de l\'upload', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur upload:', error);
            this.showNotification('Erreur lors de l\'upload', 'error');
        }
    },
    
    // Configurer les écouteurs d'événements avec gestion de sécurité
    setupEventListeners: function() {
        console.log('[KRONOS] Configuration des écouteurs d\'événements...');
        
        // Initialiser les écouteurs de notifications et mentions
        this.setupNotificationListeners();
        // Pins UI
        this.bindPinsUI();

        // ============================================
        // DÉLÉGATION D'ÉVÉNEMENTS PRINCIPALE
        // ============================================
        document.addEventListener('click', (e) => {
            // Ignorer les clics dans la liste de mention (gérés séparément)
            if (e.target.closest('.mention-list')) return;
            
            // Fermer la liste de mention si clic ailleurs
            if (this.elements.mentionList && this.elements.mentionList.style.display !== 'none') {
                this.hideMentionList();
            }

            const target = e.target.closest('[data-action]');
            if (!target) return;
            
            const action = target.dataset.action;
            
            switch (action) {
                case 'settings':
                    this.showSettings('profile');
                    break;
                case 'profile':
                    console.log('[KRONOS] Ouverture du profil via data-action');
                    this.showSettings('profile');
                    break;
                case 'members':
                    this.togglePanel('members');
                    break;
                case 'files':
                    this.togglePanel('files');
                    break;
                case 'panic':
                    this.triggerPanic();
                    break;
                case 'private':
                    if (this.elements.privatePanel) {
                        this.elements.privatePanel.classList.add('open');
                    }
                    break;
            }
        });
        
        // ============================================
        // ÉCOUTEURS DIRECTS POUR LES BOUTONS PRINCIPAUX
        // ============================================
        
        // Indicateur utilisateur (avatar + nom) - Correction BUG PROFIL
        const userIndicator = document.getElementById('user-indicator');
        if (userIndicator) {
            // Supprimer les anciens écouteurs pour éviter les doublons (clone)
            const newUserIndicator = userIndicator.cloneNode(true);
            userIndicator.parentNode.replaceChild(newUserIndicator, userIndicator);
            this.elements.userIndicator = newUserIndicator; // Mettre à jour la référence
            
            this.elements.userIndicator.addEventListener('click', (e) => {
                console.log('[KRONOS] Clic sur userIndicator (corrigé)');
                e.preventDefault();
                e.stopPropagation();
                
                // Si une modale est déjà ouverte, on la ferme, sinon on ouvre le profil
                const overlay = document.getElementById('modal-overlay');
                const modal = document.getElementById('settings-modal');
                const isOpen = overlay && overlay.style.display === 'flex' && modal && modal.style.display !== 'none';
                
                if (isOpen) {
                    this.hideAllModals();
                } else {
                    this.showSettings('profile');
                }
            });
        } else {
            console.warn('[KRONOS] userIndicator NON TROUVÉ!');
        }
        if (this.elements.profileBtn) {
            this.elements.profileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[KRONOS] Clic sur le bouton profil');
                const overlay = document.getElementById('modal-overlay');
                const modal = document.getElementById('settings-modal');
                const isOpen = overlay && overlay.style.display === 'flex' && modal && modal.style.display !== 'none';
                if (isOpen) {
                    this.hideAllModals();
                } else {
                    this.showSettings('profile');
                }
            });
        }
        
        // Avatar utilisateur
        if (this.elements.userAvatar) {
            this.elements.userAvatar.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showSettings('profile');
            });
        }
        
        // ============================================
        // AUTRES ÉCOUTEURS
        // ============================================
        
        // Envoi de message avec Entrée
        if (this.elements.messageInput) {
            this.elements.messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
        
        // Auto-resize de l'input
        if (this.elements.messageInput) {
            this.elements.messageInput.addEventListener('input', () => {
                this.elements.messageInput.style.height = 'auto';
                this.elements.messageInput.style.height = 
                    Math.min(this.elements.messageInput.scrollHeight, 200) + 'px';
                
                if (this.state.currentChannel && this.socket && this.state.isConnected) {
                    this.socket.emit('typing', {
                        channel_id: this.state.currentChannel.id,
                        typing: true
                    });
                    
                    clearTimeout(this.typingTimeout);
                    this.typingTimeout = setTimeout(() => {
                        this.socket.emit('typing', {
                            channel_id: this.state.currentChannel.id,
                            typing: false
                        });
                    }, this.config.typingDebounce);
                }
            });
        }
        
        // Bouton envoyer
        if (this.elements.sendBtn) {
            this.elements.sendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
            this.elements.sendBtn.type = 'button';
        }
        
        // Bouton pièce jointe - ouvre la sélection de fichiers
        if (this.elements.attachBtn) {
            this.elements.attachBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const fileInput = document.getElementById('message-file-input');
                if (fileInput) {
                    fileInput.click();
                }
            });
        }
        
        // Gestionnaire pour l'input file
        const messageFileInput = document.getElementById('message-file-input');
        if (messageFileInput) {
            messageFileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleFileSelect(e.target.files);
                    e.target.value = ''; // Reset pour pouvoir sélectionner les mêmes fichiers
                }
            });
        }
        
        // Drag & drop sur la zone de compose
        const composeArea = document.getElementById('compose-area');
        if (composeArea) {
            composeArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                composeArea.classList.add('drag-over');
            });
            
            composeArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                composeArea.classList.remove('drag-over');
            });
            
            composeArea.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                composeArea.classList.remove('drag-over');
                
                if (e.dataTransfer.files.length > 0) {
                    this.handleFileSelect(e.dataTransfer.files);
                }
            });
        }
        
        // Paste pour les images
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            
            const files = [];
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    files.push(item.getAsFile());
                }
            }
            
            if (files.length > 0) {
                e.preventDefault();
                this.handleFileSelect(files);
            }
        });
        
        // Bouton membres
        if (this.elements.membersBtn) {
            this.elements.membersBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePanel('members');
            });
        }
        
        // Bouton fichiers
        if (this.elements.filesBtn) {
            this.elements.filesBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePanel('files');
            });
        }
        
        // Toggle Settings avec le même bouton (ouvrir/fermer)
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const overlay = document.getElementById('modal-overlay');
                const modal = document.getElementById('settings-modal');
                const isOpen = overlay && overlay.style.display === 'flex' && modal && modal.style.display !== 'none';
                if (isOpen) {
                    this.hideAllModals();
                } else {
                    this.showSettings('profile');
                }
            });
        }
        if (this.elements.privateFilesBtn) {
            this.elements.privateFilesBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePrivateFilesPanel();
            });
        }
        if (this.elements.privateAttachBtn && this.elements.privateFileInput) {
            this.elements.privateAttachBtn.addEventListener('click', () => this.elements.privateFileInput.click());
            this.elements.privateFileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleFileSelect(e.target.files);
                    e.target.value = '';
                }
            });
        }
        if (this.elements.privateSendBtn && this.elements.privateMessageInput) {
            this.elements.privateSendBtn.addEventListener('click', () => this.sendPrivateMessage());
            this.elements.privateMessageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendPrivateMessage();
                }
            });
        }
        if (this.elements.closePrivateChat) {
            this.elements.closePrivateChat.addEventListener('click', () => {
                this.closePrivateConversation();
            });
        }
        if (this.elements.leavePrivateChat) {
            this.elements.leavePrivateChat.addEventListener('click', () => {
                this.leavePrivateConversation();
            });
        }
        
        // Fermeture des panels
        if (this.elements.closeMembers) {
            this.elements.closeMembers.addEventListener('click', () => this.closePanel('members'));
        }
        if (this.elements.closeFiles) {
            this.elements.closeFiles.addEventListener('click', () => this.closePanel('files'));
        }
        if (this.elements.closeProfile) {
            this.elements.closeProfile.addEventListener('click', () => this.closePanel('profile'));
        }
        
        // Écouters des onglets du panneau membres
        document.querySelectorAll('.members-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchMembersTab(tab.dataset.tab);
            });
        });
        
        // Fermer les panels en appuyant sur Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllPanels();
                this.hideContextMenu();
                this.hideAllModals();
                this.closePrivateFilesPanel();
            }
        });
        
        // Changement de fichiers
        if (this.elements.fileInput) {
            this.elements.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.uploadFiles(e.target.files);
                    e.target.value = '';
                }
            });
        }
        
        // Drag & drop
        document.body.addEventListener('dragover', (e) => {
            e.preventDefault();
            document.body.classList.add('dragging');
        });
        
        document.body.addEventListener('dragleave', () => {
            document.body.classList.remove('dragging');
        });
        
        document.body.addEventListener('drop', (e) => {
            e.preventDefault();
            document.body.classList.remove('dragging');
            
            if (e.dataTransfer.files.length > 0) {
                this.uploadFiles(e.dataTransfer.files);
            }
        });
        
        // Annuler la réponse
        if (this.elements.replyCancel) {
            this.elements.replyCancel.addEventListener('click', () => this.cancelReply());
        }
        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.cancelEdit();
            });
        }
        if (this.elements.privateCancelEditBtn) {
            this.elements.privateCancelEditBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.cancelEdit();
            });
        }
        
        // Panic Mode
        if (this.elements.panicBtn) {
            this.elements.panicBtn.addEventListener('click', () => this.triggerPanic());
        }
        
        const togglePrivateSidebar = document.getElementById('toggle-private-sidebar');
        if (togglePrivateSidebar) {
            togglePrivateSidebar.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.elements.privatePanel) {
                    this.elements.privatePanel.classList.add('open');
                }
                this.loadDMConversations();
            });
        }
        
        // ============================================
        // RACCOURCI CLAVIER PANIC - VERSION CORRIGÉE
        // ============================================
        // Utilise useCapture pour intercepter AVANT les inputs
        // et event.code pour une détection plus fiable
        document.addEventListener('keydown', (e) => {
            // Si pas de hotkey configuré, ignorer
            if (!this.state.panicHotkey) return;
            
            // Parser le hotkey attendu
            const hotkeyParts = this.state.panicHotkey.split('+');
            const expectedKey = hotkeyParts[hotkeyParts.length - 1].toLowerCase();
            const needCtrl = hotkeyParts.includes('Control');
            const needShift = hotkeyParts.includes('Shift');
            const needAlt = hotkeyParts.includes('Alt');
            const needMeta = hotkeyParts.includes('Meta');  // Cmd sur Mac
            
            // Vérifier les modificateurs
            const hasCtrl = e.ctrlKey || e.metaKey;  // metaKey pour Cmd sur Mac
            const hasShift = e.shiftKey;
            const hasAlt = e.altKey;
            
            // Vérifier si la touche correspond (utilise event.code pour la touche physique)
            const pressedKey = e.code.replace('Key', '').toLowerCase();
            const targetKey = expectedKey.toLowerCase();
            
            // Compatibilité: checker plusieurs formats de touche
            let keyMatches = false;
            
            // Vérifier avec event.code (touche physique)
            if (pressedKey === targetKey) {
                keyMatches = true;
            }
            // Vérifier avec event.key (caractère réel)
            else if (e.key.toLowerCase() === targetKey) {
                keyMatches = true;
            }
            // Vérifications spéciales pour les touches communes
            else if (targetKey === 'space' && e.code === 'Space') {
                keyMatches = true;
            }
            else if (targetKey === 'escape' && e.code === 'Escape') {
                keyMatches = true;
            }
            else if (targetKey === 'enter' && e.code === 'Enter') {
                keyMatches = true;
            }
            else if (targetKey === 'tab' && e.code === 'Tab') {
                keyMatches = true;
            }
            else if (targetKey === 'backspace' && e.code === 'Backspace') {
                keyMatches = true;
            }
            else if (targetKey === 'delete' && e.code === 'Delete') {
                keyMatches = true;
            }
            
            // Vérifier si les modificateurs correspondent
            const modifiersMatch = 
                (!needCtrl || hasCtrl) &&
                (!needShift || hasShift) &&
                (!needAlt || hasAlt) &&
                (!needMeta || e.metaKey);
            
            // Si tout correspond, déclencher le panic
            if (keyMatches && modifiersMatch) {
                // Empêcher le comportement par défaut
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                console.log('[KRONOS] Raccourci panic détecté:', this.state.panicHotkey);
                this.triggerPanic();
                
                return false;  // Empêcher la propagation
            }
        }, true);  // true = useCapture (intercepte en phase de capture)
        
        // Fermer les modales avec l'overlay (approche directe)
        const modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) {
            console.log('[KRONOS] Ajout du listener sur modal-overlay');
            modalOverlay.addEventListener('click', (e) => {
                console.log('[KRONOS] Clic sur overlay, target:', e.target.tagName, 'modalOverlay:', modalOverlay);
                if (e.target === modalOverlay) {
                    this.hideAllModals();
                }
            });
        } else {
            console.warn('[KRONOS] modal-overlay non trouvé!');
        }
        
        // Boutons de fermeture des modales
        document.getElementById('close-settings')?.addEventListener('click', (e) => {
            console.log('[KRONOS] close-settings cliqué');
            e.preventDefault();
            e.stopPropagation();
            this.hideAllModals();
        });

        const closeSettingsBtn = document.getElementById('close-settings');
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('mouseenter', () => {
                closeSettingsBtn.style.background = 'var(--danger-dim)';
                closeSettingsBtn.style.borderColor = 'var(--danger)';
                closeSettingsBtn.style.color = 'var(--danger)';
            });
            closeSettingsBtn.addEventListener('mouseleave', () => {
                closeSettingsBtn.style.background = '';
                closeSettingsBtn.style.borderColor = 'var(--border)';
                closeSettingsBtn.style.color = 'var(--text-secondary)';
            });
        }
        
        document.getElementById('close-admin')?.addEventListener('click', () => {
            this.hideAllModals();
        });
        
        document.getElementById('close-viewer')?.addEventListener('click', () => {
            this.hideAllModals();
        });
        
        console.log('[KRONOS] Tous les écouteurs configurés');
    },
    

    
    // Afficher les paramètres - Version simplifiée et robuste
    showSettings: function(tab = 'profile') {
        console.log('[KRONOS] showSettings appelé avec tab:', tab);
        // console.trace('[KRONOS] Stack trace pour debugging'); // trop verbeux en prod
        
        // Récupérer directement les éléments du DOM (approche directe)
        const modalOverlay = document.getElementById('modal-overlay');
        const settingsModal = document.getElementById('settings-modal');
        const settingsContent = settingsModal?.querySelector('.settings-content');
        
        console.log('[KRONOS] modalOverlay trouvé:', !!modalOverlay);
        console.log('[KRONOS] settingsModal trouvé:', !!settingsModal);
        console.log('[KRONOS] settingsContent trouvé:', !!settingsContent);
        
        if (!modalOverlay || !settingsModal) {
            console.error('[KRONOS] Éléments modal non trouvés dans le DOM!');
            alert('Erreur: Modale non trouvée. Vérifiez la console.');
            return;
        }
        
        // Afficher l'overlay + modal en respectant le CSS
        modalOverlay.style.display = 'flex';
        modalOverlay.style.pointerEvents = 'auto';
        settingsModal.style.display = 'block';
        settingsModal.style.visibility = '';
        settingsModal.style.opacity = '';
        settingsModal.style.border = '';
        settingsModal.style.zIndex = '';
        console.log('[KRONOS] Overlay + settings modal affichés');
        
        // Charger le contenu de l'onglet
        if (settingsContent) {
            console.log('[KRONOS] Chargement de l\'onglet:', tab);
            this.loadSettingsTab(tab);
        } else {
            console.warn('[KRONOS] settings-content non trouvé, création...');
            // Créer le conteneur s'il n'existe pas
            const newContent = document.createElement('div');
            newContent.className = 'settings-content';
            settingsModal.appendChild(newContent);
            this.loadSettingsTab(tab);
        }
        
        // Configurer les onglets si pas encore fait
        if (settingsModal && !settingsModal.dataset.tabsConfigured) {
            console.log('[KRONOS] Configuration des onglets...');
            settingsModal.dataset.tabsConfigured = 'true';
            
            settingsModal.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    settingsModal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.loadSettingsTab(btn.dataset.tab);
                });
            });
            
            // Afficher/masquer l'onglet admin
            const adminTab = settingsModal.querySelector('.tab-btn[data-tab="admin"]');
            if (adminTab) {
                const isAdmin = this.state.user?.role === 'admin' || this.state.user?.role === 'supreme';
                adminTab.style.display = isAdmin ? 'inline-block' : 'none';
            }
        }
        
        // Activer l'onglet courant
        const activeTab = settingsModal.querySelector(`.tab-btn[data-tab="${tab}"]`);
        if (activeTab) {
            settingsModal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            activeTab.classList.add('active');
        }
        
        console.log('[KRONOS] showSettings terminé avec succès');
    },
    
    // Créer l'overlay de modal
    createModalOverlay: function() {
        console.log('[KRONOS] Création de l\'overlay modal');
        
        let modalOverlay = document.getElementById('modal-overlay');
        if (!modalOverlay) {
            console.log('[KRONOS] Overlay pas trouvé, création dynamique...');
            modalOverlay = document.createElement('div');
            modalOverlay.id = 'modal-overlay';
            modalOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(8px);
                display: none;
                justify-content: center;
                align-items: center;
                z-index: 2000;
            `;
            
            // Ajouter un écouteur pour fermer en cliquant sur l'overlay
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    this.hideAllModals();
                }
            });
            
            document.body.appendChild(modalOverlay);
            console.log('[KRONOS] Overlay créé dynamiquement et ajouté au DOM');
        } else {
            console.log('[KRONOS] Overlay déjà existant dans le HTML');
        }
        
        // S'assurer que la classe de style est présente (centrage correct)
        try { modalOverlay.classList.add('modal-overlay'); } catch (_) {}
        
        // TOUJOURS définir this.elements.modalOverlay (que l'overlay existe déjà ou non)
        this.elements.modalOverlay = modalOverlay;
        console.log('[KRONOS] this.elements.modalOverlay défini');
        
        // Créer settingsModal
        this.createSettingsModal();
    },
    
    // Créer la modal des paramètres
    createSettingsModal: function() {
        let settingsModal = document.getElementById('settings-modal');
        if (!settingsModal) {
            console.log('[KRONOS] Settings modal pas trouvée, création dynamique...');
            settingsModal = document.createElement('div');
            settingsModal.id = 'settings-modal';
            settingsModal.style.cssText = `
                background: var(--bg-surface);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                padding: var(--space-lg);
                max-width: 500px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
            `;
            
            const modalOverlay = document.getElementById('modal-overlay') || this.elements.modalOverlay;
            if (modalOverlay) {
                modalOverlay.appendChild(settingsModal);
            }
            console.log('[KRONOS] Settings modal créée dynamiquement');
        } else {
            console.log('[KRONOS] Settings modal déjà existante dans le HTML');
        }
        
        // TOUJOURS définir this.elements.settingsModal
        this.elements.settingsModal = settingsModal;
        console.log('[KRONOS] this.elements.settingsModal défini');
    },
    
    // Charger le contenu d'un onglet des paramètres
    loadSettingsTab: async function(tab) {
        if (!this.elements.settingsModal) return;
        
        const content = this.elements.settingsModal.querySelector('.settings-content');
        if (!content) {
            // Créer le conteneur de contenu s'il n'existe pas
            const contentDiv = document.createElement('div');
            contentDiv.className = 'settings-content';
            this.elements.settingsModal.appendChild(contentDiv);
        }
        
        const contentEl = this.elements.settingsModal.querySelector('.settings-content');
        if (!contentEl) return;
        
        switch (tab) {
            case 'profile':
                contentEl.innerHTML = `
                    <div class="form-group">
                        <label>Nom d'affichage (Pseudonyme)</label>
                        <div style="position: relative;">
                            <input type="text" id="setting-display-name" 
                                   value="${this.escapeHtml(this.state.user?.display_name || '')}"
                                   placeholder="Votre nom affiché"
                                   maxlength="30"
                                   style="padding-right: 40px;">
                            <div id="nickname-status-icon" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 1.2em;"></div>
                        </div>
                        <div id="nickname-error-msg" style="color: var(--error); font-size: 0.85em; margin-top: 5px; display: none;"></div>
                        <div id="nickname-suggestions" style="margin-top: 10px; display: none;">
                            <label style="font-size: 0.8em; color: var(--text-muted); display: block; margin-bottom: 5px;">Suggestions disponibles :</label>
                            <div class="suggestions-list" style="display: flex; gap: 8px; flex-wrap: wrap;"></div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Bio</label>
                        <textarea id="setting-bio" rows="4" 
                                  placeholder="Parlez-nous de vous">${this.escapeHtml(this.state.user?.bio || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Photo de profil</label>
                        <div class="avatar-upload-container">
                            <div class="avatar-preview">
                                <img src="${this.state.user?.avatar || '/static/icons/default_avatar.svg'}" alt="Avatar actuel" id="current-avatar-preview">
                                <div class="avatar-preview-overlay">
                                    <span>Cliquez pour<br>changer</span>
                                </div>
                            </div>
                            <label class="avatar-upload-btn">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="17 8 12 3 7 8"/>
                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                </svg>
                                Choisir une photo
                                <input type="file" id="setting-avatar" class="avatar-upload-input" accept="image/*">
                            </label>
                            <span class="avatar-upload-hint">JPG, PNG, GIF • Max 5MB</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Bannière</label>
                        <div class="avatar-upload-container">
                            <div id="current-banner-preview" style="width:100%;height:120px;background:var(--bg-secondary);border:1px solid var(--border);background-size:cover;background-position:center;"></div>
                            <label class="avatar-upload-btn" style="margin-top:8px;position:static;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="17 8 12 3 7 8"/>
                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                </svg>
                                Choisir une bannière
                                <input type="file" id="setting-banner" class="avatar-upload-input" accept="image/*">
                            </label>
                            <span class="avatar-upload-hint">JPG, PNG, GIF • Max 5MB</span>
                        </div>
                    </div>
                    <button class="btn-submit" id="save-profile">Enregistrer</button>
                `;
                
                const avatarInput = document.getElementById('setting-avatar');
                const bannerInput = document.getElementById('setting-banner');
                const displayNameInput = document.getElementById('setting-display-name');
                const nicknameStatusIcon = document.getElementById('nickname-status-icon');
                const nicknameErrorMsg = document.getElementById('nickname-error-msg');
                const nicknameSuggestions = document.getElementById('nickname-suggestions');
                const suggestionsList = nicknameSuggestions?.querySelector('.suggestions-list');
                
                const avatarPreview = document.getElementById('current-avatar-preview');
                const bannerPreview = document.getElementById('current-banner-preview');
                
                let checkTimeout = null;
                
                if (avatarPreview && avatarInput) {
                    avatarPreview.onclick = () => {
                        avatarInput.click();
                    };
                }
                
                if (displayNameInput) {
                    displayNameInput.addEventListener('input', (e) => {
                        const username = e.target.value.trim();
                        
                        // Réinitialisation immédiate de l'état visuel
                        nicknameStatusIcon.innerHTML = '⏳';
                        nicknameErrorMsg.style.display = 'none';
                        nicknameSuggestions.style.display = 'none';
                        
                        if (checkTimeout) clearTimeout(checkTimeout);
                        
                        if (username.length < 3) {
                            nicknameStatusIcon.innerHTML = '⚠️';
                            return;
                        }
                        
                        checkTimeout = setTimeout(async () => {
                            try {
                                const response = await fetch('/api/auth/check-nickname', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ username })
                                });
                                
                                const data = await response.json();
                                
                                if (!data.valid) {
                                    nicknameStatusIcon.innerHTML = '❌';
                                    nicknameErrorMsg.textContent = data.error;
                                    nicknameErrorMsg.style.display = 'block';
                                } else if (!data.available) {
                                    nicknameStatusIcon.innerHTML = '👥';
                                    
                                    // Proposer d'appliquer la première suggestion automatiquement
                                    const firstSug = data.suggestions && data.suggestions[0];
                                    nicknameErrorMsg.innerHTML = `
                                        ${data.error} 
                                        ${firstSug ? `<a href="#" class="apply-sug" style="color: var(--accent); margin-left: 5px; text-decoration: underline;">Appliquer "${firstSug}" ?</a>` : ''}
                                    `;
                                    nicknameErrorMsg.style.display = 'block';

                                    const applyBtn = nicknameErrorMsg.querySelector('.apply-sug');
                                    if (applyBtn) {
                                        applyBtn.onclick = (e) => {
                                            e.preventDefault();
                                            displayNameInput.value = firstSug;
                                            displayNameInput.dispatchEvent(new Event('input'));
                                        };
                                    }
                                    
                                    // Afficher les suggestions additionnelles
                                    if (data.suggestions && data.suggestions.length > 0) {
                                        suggestionsList.innerHTML = '';
                                        data.suggestions.forEach(sug => {
                                            const badge = document.createElement('span');
                                            badge.className = 'suggestion-badge';
                                            badge.textContent = sug;
                                            badge.style.cssText = `
                                                background: var(--accent);
                                                color: #000;
                                                padding: 4px 10px;
                                                border-radius: 15px;
                                                font-size: 0.85em;
                                                cursor: pointer;
                                                font-weight: bold;
                                                transition: transform 0.2s;
                                            `;
                                            badge.onclick = () => {
                                                displayNameInput.value = sug;
                                                displayNameInput.dispatchEvent(new Event('input'));
                                            };
                                            badge.onmouseenter = () => badge.style.transform = 'scale(1.05)';
                                            badge.onmouseleave = () => badge.style.transform = 'scale(1)';
                                            suggestionsList.appendChild(badge);
                                        });
                                        nicknameSuggestions.style.display = 'block';
                                    }
                                } else {
                                    nicknameStatusIcon.innerHTML = '✅';
                                }
                            } catch (err) {
                                console.error('[KRONOS] Nickname check error:', err);
                            }
                        }, 500);
                    });
                }
                
                if (avatarInput) {
                    avatarInput.addEventListener('change', (e) => {
                        console.log('[KRONOS] setting-avatar change event');
                        const file = e.target.files[0];
                        if (file) {
                            if (file.size > 5 * 1024 * 1024) {
                                this.showNotification('Le fichier ne doit pas dépasser 5MB', 'error');
                                e.target.value = '';
                                return;
                            }
                            
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const preview = document.getElementById('current-avatar-preview');
                                if (preview) {
                                    preview.src = e.target.result;
                                }
                            };
                            reader.readAsDataURL(file);
                        }
                    });
                }
                
                if (bannerInput) {
                    bannerInput.addEventListener('change', (e) => {
                        console.log('[KRONOS] setting-banner change event');
                        const file = e.target.files[0];
                        if (file) {
                            if (file.size > 5 * 1024 * 1024) {
                                this.showNotification('Le fichier ne doit pas dépasser 5MB', 'error');
                                e.target.value = '';
                                return;
                            }
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const preview = document.getElementById('current-banner-preview');
                                if (preview) {
                                    preview.style.backgroundImage = `url(${e.target.result})`;
                                }
                            };
                            reader.readAsDataURL(file);
                        }
                    });
                    // Initialiser l'aperçu avec la bannière existante
                    const existing = this.state.user?.banner;
                    if (existing) {
                        const preview = document.getElementById('current-banner-preview');
                        if (preview) preview.style.backgroundImage = `url(${existing})`;
                    }
                }
                
                document.getElementById('save-profile')?.addEventListener('click', () => this.saveProfile());
                break;
                
            case 'shortcuts':
                contentEl.innerHTML = `
                    <div class="form-group">
                        <label>Raccourci Panic Mode</label>
                        <input type="text" id="setting-panic-hotkey" 
                               value="${this.escapeHtml(this.state.panicHotkey || 'Control+Space')}"
                               placeholder="Cliquez ici et appuyez sur la touche désirée">
                        <small style="color: var(--text-muted); margin-top: 4px; display: block;">
                            Cliquez sur le champ et appuyez sur la touche ou combinaison souhaitée
                        </small>
                    </div>
                    <div class="form-group">
                        <label>URL de redirection Panic</label>
                        <input type="text" id="setting-panic-url" 
                               value="${this.escapeHtml(this.state.panicUrl || '/')}"
                               placeholder="URL de redirection">
                    </div>
                    <button class="btn-submit" id="save-shortcuts">Enregistrer</button>
                `;
                
                const panicInput = document.getElementById('setting-panic-hotkey');
                if (panicInput) {
                    panicInput.addEventListener('keydown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const parts = [];
                        if (e.ctrlKey || e.metaKey) parts.push('Control');
                        if (e.shiftKey) parts.push('Shift');
                        if (e.altKey) parts.push('Alt');
                        parts.push(e.key);
                        
                        panicInput.value = parts.join('+');
                    });
                }
                
                document.getElementById('save-shortcuts')?.addEventListener('click', () => this.saveShortcuts());
                break;
                
            case 'appearance':
                contentEl.innerHTML = `
                    <div class="form-group">
                        <label>Thème</label>
                        <select id="setting-theme">
                            <option value="system">Système</option>
                            <option value="light">Clair</option>
                            <option value="dark">Sombre</option>
                        </select>
                    </div>
                    <button class="btn-submit" id="save-appearance">Enregistrer</button>
                `;
                (function initThemeSelect(ctx){
                    const sel = document.getElementById('setting-theme');
                    if (!sel) return;
                    const src = document.body.getAttribute('data-theme-source');
                    const cur = src === 'system' ? 'system' : (document.body.getAttribute('data-theme') || 'dark');
                    sel.value = cur;
                    document.getElementById('save-appearance')?.addEventListener('click', async () => {
                        const value = sel.value;
                        try {
                            const res = await fetch('/api/user/settings', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ theme: value })
                            });
                            if (res.ok) {
                                document.body.setAttribute('data-theme', value);
                                if (value === 'system') {
                                    ctx.applyThemePreference();
                                } else {
                                    document.body.removeAttribute('data-theme-source');
                                }
                                ctx.showNotification('Thème appliqué', 'success');
                            } else {
                                ctx.showNotification('Erreur lors de l’enregistrement du thème', 'error');
                            }
                        } catch (e) {
                            ctx.showNotification('Erreur réseau', 'error');
                        }
                    });
                })(this);
                break;
                
            case 'notifications':
                const permission = "Notification" in window ? Notification.permission : "not_supported";
                let statusText = "Activées";
                let statusColor = "var(--accent)";
                let isBlocked = false;

                if (permission === "denied") {
                    statusText = "Bloquées par le navigateur";
                    statusColor = "var(--error)";
                    isBlocked = true;
                } else if (permission === "default") {
                    statusText = "En attente d'autorisation";
                    statusColor = "var(--warning)";
                } else if (permission === "not_supported") {
                    statusText = "Non supportées sur ce navigateur";
                    statusColor = "var(--text-muted)";
                    isBlocked = true;
                }

                contentEl.innerHTML = `
                    <div class="notification-status-box" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid var(--border);">
                        <div style="font-size: 0.8em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 5px;">État du navigateur</div>
                        <div style="font-weight: bold; color: ${statusColor}; display: flex; align-items: center; gap: 8px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"></span>
                            ${statusText}
                        </div>
                        ${permission === "default" ? `
                            <button id="request-notif-now" class="btn-secondary" style="margin-top: 10px; width: 100%; font-size: 0.8em;">
                                Autoriser maintenant
                            </button>
                        ` : ''}
                        ${permission === "denied" ? `
                            <div style="font-size: 0.75em; color: var(--text-muted); margin-top: 8px; line-height: 1.4; background: rgba(255, 71, 87, 0.1); padding: 12px; border-radius: 8px; border: 1px solid var(--error);">
                                <strong style="color: var(--error); display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                                    <span style="font-size: 1.2em;">⚠️</span> BLOCAGE DE CONFIDENTIALITÉ (POLICE DU NAVIGATEUR)
                                </strong>
                                <p style="margin-bottom: 8px;">Votre navigateur affiche : <em>"Bloquée pour protéger la confidentialité"</em>. C'est un blocage automatique qui <strong>ignore</strong> les paramètres classiques du site.</p>
                                
                                <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; border: 1px dashed var(--border);">
                                    <strong style="color: var(--accent); display: block; margin-bottom: 5px; font-size: 0.9em;">LA SEULE SOLUTION POUR DÉBLOQUER :</strong>
                                    <ol style="margin: 0; padding-left: 20px; color: var(--text);">
                                        <li style="margin-bottom: 4px;">Tapez <code>chrome://settings/content/all</code> dans votre barre d'adresse.</li>
                                        <li style="margin-bottom: 4px;">Recherchez l'adresse de ce site (ex: <code>localhost</code> ou votre domaine).</li>
                                        <li style="margin-bottom: 4px;">Cliquez sur la petite flèche à droite puis sur <strong>"Effacer les données et réinitialiser les autorisations"</strong>.</li>
                                        <li style="margin-bottom: 4px;">Rechargez cette page et cliquez sur <strong>"Autoriser"</strong> quand la boîte noire apparaîtra.</li>
                                        <li><strong>Désactivez le "Brave Shield"</strong> (le lion) ou AdBlock si le message persiste.</li>
                                    </ol>
                                </div>
                                <p style="margin-top: 8px; font-weight: bold; color: var(--warning);">Note : Si vous êtes en Navigation Privée, le navigateur bloquera TOUJOURS les notifications par défaut.</p>
                            </div>
                        ` : ''}
                        ${!window.isSecureContext ? `
                            <div style="font-size: 0.75em; color: var(--error); margin-top: 8px; padding: 10px; border: 1px solid var(--error); border-radius: 4px;">
                                <strong>Erreur de sécurité :</strong> L'API Notification nécessite une connexion sécurisée (HTTPS) ou localhost.
                            </div>
                        ` : ''}
                    </div>

                    <div class="form-group" style="${isBlocked ? 'opacity: 0.5; pointer-events: none;' : ''}">
                        <label>
                            <div class="switch">
                                <input type="checkbox" id="notif-sounds" ${this.state.notifications.sound ? 'checked' : ''}>
                                <span class="slider"></span>
                            </div>
                            Sons de notification
                        </label>
                    </div>
                    <div class="form-group" style="${isBlocked ? 'opacity: 0.5; pointer-events: none;' : ''}">
                        <label>
                            <div class="switch">
                                <input type="checkbox" id="notif-desktop" ${this.state.notifications.desktop ? 'checked' : ''}>
                                <span class="slider"></span>
                            </div>
                            Notifications sur le bureau
                        </label>
                    </div>
                    <div class="form-group" style="${isBlocked ? 'opacity: 0.5; pointer-events: none;' : ''}">
                        <label>
                            <div class="switch">
                                <input type="checkbox" id="notif-mentions" ${this.state.notifications.mentions ? 'checked' : ''}>
                                <span class="slider"></span>
                            </div>
                            Notifications @mentions
                        </label>
                    </div>
                    <div class="form-group">
                        <label>Raccourci clavier (ex: Alt+N)</label>
                        <input type="text" id="notif-shortcut" value="${this.escapeHtml(this.state.notifications.shortcut || 'Alt+N')}" placeholder="Alt+N">
                    </div>
                    <button class="btn-submit" id="save-notifications">Enregistrer les préférences</button>
                `;
                
                document.getElementById('request-notif-now')?.addEventListener('click', () => {
                    Notification.requestPermission().then(p => {
                        this.showSettings('notifications'); // Recharger la vue
                        if (p === "granted") this.registerServiceWorker();
                    });
                });

                document.getElementById('save-notifications')?.addEventListener('click', () => {
                    this.state.notifications.sound = document.getElementById('notif-sounds').checked;
                    this.state.notifications.desktop = document.getElementById('notif-desktop').checked;
                    this.state.notifications.mentions = document.getElementById('notif-mentions').checked;
                    this.state.notifications.shortcut = document.getElementById('notif-shortcut').value;
                    
                    this.updateNotificationButton();
                    
                    if (this.state.notifications.desktop && "Notification" in window) {
                         if (Notification.permission !== "granted" && Notification.permission !== "denied") {
                            Notification.requestPermission();
                        }
                    }
                    
                    this.showNotification('Paramètres de notifications enregistrés');
                });
                break;
                
            case 'password':
                contentEl.innerHTML = `
                    <div class="form-group">
                        <label>Mot de passe actuel</label>
                        <input type="password" id="current-password">
                    </div>
                    <div class="form-group">
                        <label>Nouveau mot de passe</label>
                        <input type="password" id="new-password">
                    </div>
                    <div class="form-group">
                        <label>Confirmer le nouveau mot de passe</label>
                        <input type="password" id="confirm-password">
                    </div>
                    <button class="btn-submit" id="save-password">Changer le mot de passe</button>
                `;
                
                document.getElementById('save-password')?.addEventListener('click', () => this.changePassword());
                break;
                
            case 'admin':
                contentEl.innerHTML = `
                    <button class="btn-secondary" id="open-admin-panel" style="margin-bottom: var(--space-md);">
                        Ouvrir le panneau d'administration
                    </button>
                `;
                
                document.getElementById('open-admin-panel')?.addEventListener('click', () => {
                    this.hideAllModals();
                    this.showAdminPanel();
                });
                break;
        }
    },
    
    // Enregistrer le profil
    saveProfile: async function() {
        const displayName = document.getElementById('setting-display-name')?.value;
        const bio = document.getElementById('setting-bio')?.value;
        const avatarInput = document.getElementById('setting-avatar');
        const bannerInput = document.getElementById('setting-banner');
        let bannerFilename = null;
        let avatarFilename = null;
        
        try {
            console.log('[KRONOS] saveProfile: start');
            if (!displayName && !bio && !(avatarInput && avatarInput.files.length) && !(bannerInput && bannerInput.files.length)) {
                console.log('[KRONOS] saveProfile: nothing to update');
            }
            if (avatarInput && avatarInput.files.length > 0) {
                const avatarFormData = new FormData();
                avatarFormData.append('file', avatarInput.files[0]);
                
                this.showNotification('Upload de l\'avatar...', 'info');
                
                const avatarResponse = await fetch('/api/upload/avatar', {
                    method: 'POST',
                    body: avatarFormData
                });
                
                if (avatarResponse.ok) {
                    const avatarData = await avatarResponse.json();
                    this.state.user.avatar = avatarData.avatar_url;
                    // Extraire le filename pour persistance côté DB
                    if (avatarData.avatar_url) {
                        try {
                            const parts = avatarData.avatar_url.split('/');
                            avatarFilename = parts[parts.length - 1] || null;
                        } catch (_) {}
                    }
                } else {
                    let message = 'Erreur lors de l\'upload de l\'avatar';
                    try {
                        const ct = avatarResponse.headers.get('content-type') || '';
                        if (ct.includes('application/json')) {
                            const error = await avatarResponse.json();
                            if (error && error.error) message = `${message}: ${error.error}`;
                        } else {
                            const txt = await avatarResponse.text();
                            if (txt) message = `${message}: ${txt}`;
                        }
                        message = `${message} (HTTP ${avatarResponse.status})`;
                        console.error('[KRONOS] saveProfile avatar error:', error);
                    } catch (e) {
                        console.error('[KRONOS] saveProfile avatar error parse failed:', e);
                    }
                    this.showNotification(message, 'error');
                    return;
                }
            }
            
            if (bannerInput && bannerInput.files.length > 0) {
                const bannerFormData = new FormData();
                bannerFormData.append('file', bannerInput.files[0]);
                bannerFormData.append('type', 'banner');
                
                this.showNotification('Upload de la bannière...', 'info');
                const bannerResponse = await fetch('/api/user/upload-profile-image', {
                    method: 'POST',
                    body: bannerFormData
                });
                if (bannerResponse.ok) {
                    const bannerData = await bannerResponse.json();
                    bannerFilename = bannerData.filename;
                } else {
                    let message = 'Erreur lors de l\'upload de la bannière';
                    try {
                        const ct = bannerResponse.headers.get('content-type') || '';
                        if (ct.includes('application/json')) {
                            const error = await bannerResponse.json();
                            if (error && error.error) message = `${message}: ${error.error}`;
                        } else {
                            const txt = await bannerResponse.text();
                            if (txt) message = `${message}: ${txt}`;
                        }
                        message = `${message} (HTTP ${bannerResponse.status})`;
                        console.error('[KRONOS] saveProfile banner error:', error);
                    } catch (e) {
                        console.error('[KRONOS] saveProfile banner error parse failed:', e);
                    }
                    this.showNotification(message, 'error');
                    return;
                }
            }
            
            const body = { };
            if (bio !== undefined && bio !== null) body.bio = bio;
            if (displayName && displayName.trim().length > 0) body.display_name = displayName.trim();
            if (bannerFilename) body.banner_filename = bannerFilename;
            if (avatarFilename) body.avatar_filename = avatarFilename;
            
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (response.ok) {
                const data = await response.json();
                this.state.user = data.user || this.state.user;
                if (bannerFilename) this.state.user.banner = `/uploads/banners/${bannerFilename}`;
                if (avatarFilename) this.state.user.avatar = `/uploads/avatars/${avatarFilename}`;
                this.updateUserIndicator();
                this.showNotification('Profil mis à jour avec succès');
            } else {
                let message = 'Erreur lors de la mise à jour';
                try {
                    const error = await response.json();
                    if (error && error.error) message = error.error;
                    console.error('[KRONOS] saveProfile update error:', error);
                } catch (_) {}
                this.showNotification(message, 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
            this.showNotification('Erreur lors de l\'enregistrement', 'error');
        }
    },
    
    // Enregistrer les raccourcis
    saveShortcuts: async function() {
        const panicHotkey = document.getElementById('setting-panic-hotkey')?.value;
        const panicUrl = document.getElementById('setting-panic-url')?.value;
        
        try {
            const response = await fetch('/api/panic/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ panic_hotkey: panicHotkey, panic_url: panicUrl })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.state.panicHotkey = data.panic_hotkey;
                this.state.panicUrl = data.panic_url;
                
                this.showNotification('Raccourcis mis à jour - Rechargement...');
                setTimeout(() => window.location.reload(), 1000);
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    // Changer le mot de passe
    changePassword: async function() {
        const currentPassword = document.getElementById('current-password')?.value;
        const newPassword = document.getElementById('new-password')?.value;
        const confirmPassword = document.getElementById('confirm-password')?.value;
        
        if (newPassword !== confirmPassword) {
            this.showNotification('Les mots de passe ne correspondent pas', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/user/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_password: currentPassword, new_password: newPassword })
            });
            
            if (response.ok) {
                this.showNotification('Mot de passe changé avec succès');
                this.hideAllModals();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Erreur', 'error');
            }
        } catch (error) {
            console.error('[KRONOS] Erreur:', error);
        }
    },
    
    // Afficher le panneau d'administration
    showAdminPanel: async function() {
        if (!this.elements.modalOverlay) {
            console.error('[KRONOS] Éléments admin non trouvés!');
            return;
        }
        
        this.elements.modalOverlay.style.display = 'flex';
        
        // Créer la modal admin si elle n'existe pas
        let adminModal = document.getElementById('admin-modal');
        if (!adminModal) {
            adminModal = document.createElement('div');
            adminModal.id = 'admin-modal';
            adminModal.style.cssText = `
                background: var(--bg-surface);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                padding: var(--space-lg);
                max-width: 600px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
            `;
            this.elements.modalOverlay.appendChild(adminModal);
        }
        this.elements.adminModal = adminModal;
        
        this.elements.adminModal.style.display = 'block';
        
        this.loadAdminTab('users');
        
        this.elements.adminModal.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.elements.adminModal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadAdminTab(btn.dataset.tab);
            });
        });
    },
    
    // Charger un onglet admin
    loadAdminTab: async function(tab) {
        if (!this.elements.adminModal) return;
        
        let content = this.elements.adminModal.querySelector('.admin-content');
        if (!content) {
            content = document.createElement('div');
            content.className = 'admin-content';
            this.elements.adminModal.appendChild(content);
        }
        
        switch (tab) {
            case 'users':
                try {
                    const usersResponse = await fetch('/api/admin/users');
                    if (!usersResponse.ok) {
                        content.innerHTML = '<div class="empty-state"><p>Erreur de chargement</p></div>';
                        return;
                    }
                    const usersData = await usersResponse.json();
                    
                    content.innerHTML = `
                        <div class="admin-list">
                            ${usersData.users?.map(user => `
                                <div class="admin-user-item">
                                    <img src="${user.avatar || '/static/icons/default_avatar.svg'}" alt="" class="admin-user-avatar">
                                    <div class="admin-user-info">
                                        <span class="admin-user-name">${this.escapeHtml(user.display_name || user.username)}</span>
                                        <span class="admin-user-role">@${this.escapeHtml(user.username)} - ${user.role}</span>
                                        <span class="admin-user-status ${user.is_active ? 'active' : 'banned'}">
                                            ${user.is_active ? 'Actif' : 'Banni'}
                                        </span>
                                    </div>
                                    <div class="admin-user-actions">
                                        ${!user.is_supreme ? `
                                            <button class="action-btn" data-action="kick" data-id="${user.id}">Kick</button>
                                            <button class="action-btn" data-action="ban" data-id="${user.id}">${user.is_active ? 'Ban' : 'Unban'}</button>
                                        ` : '<span class="supreme-badge">S</span>'}
                                    </div>
                                </div>
                            `).join('') || '<div class="empty-state"><p>Aucun utilisateur</p></div>'}
                        </div>
                    `;
                    
                    content.querySelectorAll('.action-btn').forEach(btn => {
                        btn.addEventListener('click', () => this.handleContextAction(btn.dataset.action, btn.dataset.id));
                    });
                } catch (error) {
                    console.error('[KRONOS] Erreur:', error);
                    content.innerHTML = '<div class="empty-state"><p>Erreur de chargement</p></div>';
                }
                break;
                
            case 'stats':
                try {
                    const statsResponse = await fetch('/api/admin/stats');
                    const statsData = await statsResponse.json();
                    
                    const diskUsed = this.formatBytes(statsData.disk_used || 0);
                    
                    content.innerHTML = `
                        <div class="stats-grid">
                            <div class="stat-card">
                                <span class="stat-number">${statsData.users || 0}</span>
                                <span class="stat-label">Utilisateurs</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-number">${statsData.channels || 0}</span>
                                <span class="stat-label">Salons</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-number">${statsData.messages || 0}</span>
                                <span class="stat-label">Messages</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-number">${statsData.files || 0}</span>
                                <span class="stat-label">Fichiers</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-number">${statsData.online_users || 0}</span>
                                <span class="stat-label">En ligne</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-number">${diskUsed}</span>
                                <span class="stat-label">Espace utilisé</span>
                            </div>
                        </div>
                    `;
                } catch (error) {
                    content.innerHTML = '<div class="empty-state"><p>Erreur de chargement</p></div>';
                }
                break;
                
            default:
                content.innerHTML = `
                    <div class="empty-state">
                        <p>Fonctionnalité en développement</p>
                    </div>
                `;
                break;
        }
    },
    
    // Cacher toutes les modales
    hideAllModals: function() {
        console.log('[KRONOS] hideAllModals appelé');
        
        // Approche directe au DOM
        const modalOverlay = document.getElementById('modal-overlay');
        const settingsModal = document.getElementById('settings-modal');
        const adminModal = document.getElementById('admin-modal');
        
        if (modalOverlay) {
            modalOverlay.style.display = 'none';
            modalOverlay.style.pointerEvents = 'none';
        }
        if (settingsModal) settingsModal.style.display = 'none';
        if (adminModal) adminModal.style.display = 'none';
        
        this.hideContextMenu();
        console.log('[KRONOS] Toutes les modales cachées');
    },
    
    // Faire défiler vers le bas
    scrollToBottom: function() {
        requestAnimationFrame(() => {
            if (this.elements.chatViewport) {
                this.elements.chatViewport.scrollTop = this.elements.chatViewport.scrollHeight;
            }
        });
    },
    
    // Afficher une notification (design identique aux toasts d'auth.js)
    showNotification: function(title, body = '', type = 'success') {
        if (arguments.length === 1 || (arguments.length === 2 && typeof body !== 'string')) {
            const message = title;
            const msgType = typeof body === 'string' ? body : (type || 'success');
            title = 'KRONOS';
            body = message;
            type = msgType;
        }

        if ("Notification" in window && Notification.permission === "granted") {
            try {
                if (document.hidden) {
                    new Notification(title, {
                        body: body,
                        icon: '/static/icons/favicon.svg'
                    });
                }
            } catch (e) {
                console.warn('[KRONOS] Échec notification système:', e);
            }
        }

        let styleTag = document.getElementById('kronos-notification-styles');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'kronos-notification-styles';
            styleTag.textContent = `
                .notification {
                    position: fixed;
                    bottom: 24px;
                    left: 50%;
                    transform: translateX(-50%) translateY(100px);
                    padding: 12px 24px;
                    background: #27272a;
                    border: 1px solid #3f3f46;
                    border-radius: 4px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 13px;
                    color: #d4d4d8;
                    box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
                    opacity: 0;
                    transition: all 0.3s ease;
                    z-index: 10000;
                }
                .notification.show {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
                .notification.success {
                    border-color: #00ff88;
                    background: rgba(0, 255, 136, 0.1);
                }
                .notification.error {
                    border-color: #ff3333;
                    background: rgba(255, 51, 51, 0.1);
                }
                .notification.warning {
                    border-color: #ffaa00;
                    background: rgba(255, 170, 0, 0.1);
                }
            `;
            document.head.appendChild(styleTag);
        }

        let container = document.getElementById('kronos-notifications-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'kronos-notifications-container';
            container.style.position = 'fixed';
            container.style.bottom = '24px';
            container.style.left = '50%';
            container.style.transform = 'translateX(-50%)';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            container.style.gap = '8px';
            container.style.zIndex = '10000';
            container.style.pointerEvents = 'none';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = body || title;
        notification.style.pointerEvents = 'auto';

        container.appendChild(notification);

        requestAnimationFrame(() => {
            notification.classList.add('show');
        });

        const close = () => {
            if (notification._isHiding) return;
            notification._isHiding = true;
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
                if (container && container.children.length === 0) {
                    container.remove();
                }
            }, 300);
        };

        let timeoutId = setTimeout(close, 3000);
        notification._removeTimeout = timeoutId;

        notification.addEventListener('click', () => {
            clearTimeout(timeoutId);
            close();
        });

        notification.addEventListener('mouseenter', () => {
            clearTimeout(notification._removeTimeout);
        });

        notification.addEventListener('mouseleave', () => {
            notification._removeTimeout = setTimeout(close, 1000);
        });

        if (this.state && this.state.notifications && this.state.notifications.sound) {
            if (typeof this.playNotificationSound === 'function') {
                try {
                    this.playNotificationSound();
                } catch (e) {
                    console.warn('[KRONOS] Échec du son de notification:', e);
                }
            }
        }
    },
    
    playNotificationSound: function() {
        try {
            const el = document.getElementById('notification-sound');
            if (el && typeof el.play === 'function') {
                const p = el.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } catch (_) {}
    },
    
    smartFillBanner: function(el, url) {
        if (!url || typeof url !== 'string' || !url.trim()) {
            return;
        }
        const img = new Image();
        const fallback = () => {
            el.style.backgroundImage = `url('${url}')`;
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
            el.style.backgroundRepeat = 'no-repeat';
        };
        img.onload = () => {
            try {
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                if (!w || !h) {
                    fallback();
                    return;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const sw = Math.max(2, Math.floor(w * 0.05));
                const left = ctx.getImageData(0, 0, sw, h).data;
                const right = ctx.getImageData(w - sw, 0, sw, h).data;
                const stats = (data) => {
                    let r = 0, g = 0, b = 0, c = data.length / 4;
                    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
                    r /= c; g /= c; b /= c;
                    let v = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        const dr = data[i]-r, dg = data[i+1]-g, db = data[i+2]-b;
                        v += dr*dr + dg*dg + db*db;
                    }
                    v /= c;
                    const edgeColor = (top) => {
                        const y0 = top ? 0 : Math.max(0, h - Math.floor(h*0.1));
                        const y1 = top ? Math.floor(h*0.1) : h;
                        let rr=0, gg=0, bb=0, cnt=0;
                        for (let y=y0; y<y1; y++) {
                            for (let x=0; x<sw; x++) {
                                const idx = (y*sw + x)*4;
                                rr += data[idx]; gg += data[idx+1]; bb += data[idx+2];
                                cnt++;
                            }
                        }
                        rr = Math.round(rr/cnt); gg = Math.round(gg/cnt); bb = Math.round(bb/cnt);
                        return `rgb(${rr}, ${gg}, ${bb})`;
                    };
                    return { variance: v, top: edgeColor(true), bottom: edgeColor(false) };
                };
                const l = stats(left);
                const rgt = stats(right);
                const bgSide = l.variance <= rgt.variance ? 'left' : 'right';
                const minVar = Math.min(l.variance, rgt.variance);
                const threshold = 800;
                if (minVar > threshold) {
                    fallback();
                    return;
                }
                const s = bgSide === 'left' ? l : rgt;
                const objectPos = bgSide === 'left' ? 'right center' : 'left center';
                el.style.backgroundImage = `url('${url}'), linear-gradient(to bottom, ${s.top}, ${s.bottom})`;
                el.style.backgroundSize = `contain, 100% 100%`;
                el.style.backgroundRepeat = `no-repeat, no-repeat`;
                el.style.backgroundPosition = `${objectPos}, center center`;
            } catch (e) {
                fallback();
            }
        };
        img.onerror = fallback;
        img.src = url;
    },
    
    hideNotification: function(notification) {
        if (!notification || notification._isHiding) return;
        notification._isHiding = true;
        clearTimeout(notification._removeTimeout);
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
            const container = document.getElementById('kronos-notifications-container');
            if (container && container.children.length === 0) {
                container.remove();
            }
        }, 300);
    },
    
    // Formater une date avec fuseau horaire français
    formatTime: function(dateStr) {
        if (!dateStr) return '--:--';
        const date = new Date(dateStr);
        // Convertir en heure française (Europe/Paris) avec gestion automatique de l'heure d'été/hiver
        return date.toLocaleTimeString('fr-FR', { 
            timeZone: 'Europe/Paris',
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
    },
    
    // Formater une date complète avec fuseau horaire français
    formatDate: function(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', { 
            timeZone: 'Europe/Paris',
            day: '2-digit', 
            month: '2-digit',
            year: 'numeric'
        });
    },
    
    // Formater la date d'inscription avec fuseau horaire français
    formatJoinDate: function(dateStr) {
        if (!dateStr) return 'Inconnue';
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', {
            timeZone: 'Europe/Paris',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    },
    
    // Formater la dernière connexion avec fuseau horaire français
    formatLastSeen: function(dateStr) {
        if (!dateStr) return 'Jamais';
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'À l\'instant';
        if (diffMins < 60) return `Il y a ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
        if (diffHours < 24) return `Il y a ${diffHours} heure${diffHours > 1 ? 's' : ''}`;
        if (diffDays < 7) return `Il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`;
        
        return date.toLocaleDateString('fr-FR', {
            timeZone: 'Europe/Paris',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    },
    
    // Formater des bytes
    formatBytes: function(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    
    // Échapper le HTML
    escapeHtml: function(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    formatMessageContent: function(content) {
        if (!content) return '';
        // Échapper le HTML pour éviter les XSS
        let formatted = this.escapeHtml(content);
        
        // Autolink : Remplacer les URLs par des liens cliquables
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        formatted = formatted.replace(urlRegex, function(url) {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="message-link">${url}</a>`;
        });

        // Remplacer les mentions @username par un span stylisé
        const self = this;
        formatted = formatted.replace(/@([a-zA-Z0-9_-]+)/g, function(match, username) {
            let className = "mention";
            // Animation si c'est l'utilisateur courant qui est mentionné
            if (self.state.user && self.state.user.username === username) {
                className += " mention-flash";
            }
            return `<span class="${className}">@${username}</span>`;
        });
        
        return formatted;
    },
    
    // WebRTC handlers (stubs)
    handleWebRTCOffer: function(data) { /* À implémenter */ },
    handleWebRTCAnswer: function(data) { /* À implémenter */ },
    handleWebRTCIceCandidate: function(data) { /* À implémenter */ },
    handleUserJoinedVoice: function(data) { /* À implémenter */ },
    handleUserLeftVoice: function(data) { /* À implémenter */ }
};

// DEBUG GLOBAL - Capturer tous les clics pour debugging
document.addEventListener('click', function(e) {
    console.log('[DEBUG-CLICK]', e.target.tagName, e.target.id, e.target.className);
    
    // Si clic sur un de nos boutons, logger explicitement
    if (e.target.id === 'settings-btn' || e.target.closest('#settings-btn')) {
        console.log('[DEBUG] Clic détecté sur #settings-btn');
    }
    if (e.target.id === 'user-indicator' || e.target.closest('#user-indicator')) {
        console.log('[DEBUG] Clic détecté sur #user-indicator');
    }
}, true); // true = capture phase

// Fonction de test globale
window.debugKronos = function() {
    console.log('=== DEBUG KRONOS ===');
    console.log('KRONOS defined:', typeof KRONOS !== 'undefined');
    console.log('showSettings defined:', typeof KRONOS?.showSettings === 'function');
    console.log('settings-btn exists:', !!document.getElementById('settings-btn'));
    console.log('user-indicator exists:', !!document.getElementById('user-indicator'));
    console.log('modal-overlay exists:', !!document.getElementById('modal-overlay'));
    console.log('settings-modal exists:', !!document.getElementById('settings-modal'));
    
    // Test direct de showSettings
    if (typeof KRONOS !== 'undefined' && KRONOS.showSettings) {
        console.log('Tentative d\'appel de showSettings...');
        KRONOS.showSettings('profile');
    }
    return 'Debug complet terminé';
};

window.handleLogout = async function() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    try { if (window.KRONOS && KRONOS.socket) KRONOS.socket.disconnect(); } catch (e) {}
    window.location.href = '/login';
};

// Démarrer l'application
document.addEventListener('DOMContentLoaded', () => {
    console.log('[KRONOS] DOMReady - Démarrage de l\'application');
    console.log('[KRONOS] KRONOS object exists:', typeof KRONOS !== 'undefined');
    console.log('[KRONOS] init function exists:', (typeof KRONOS !== 'undefined') && (typeof KRONOS.init === 'function'));
    
    // Exposer une fonction de test globale
    window.testShowSettings = function() {
        console.log('[TEST] testShowSettings appelé manuellement');
        if (typeof KRONOS !== 'undefined' && KRONOS.showSettings) {
            KRONOS.showSettings('profile');
        } else {
            console.error('[TEST] KRONOS ou showSettings non disponible');
        }
    };
    console.log('[KRONOS] Fonction test disponible: testez avec testShowSettings() dans la console');
    
    KRONOS.init();
});
