/**
 * KRONOS - Authentication JavaScript
 * Gestion de la connexion et de l'inscription
 */

const Auth = {
    // Éléments DOM
    elements: {},
    
    // Initialisation
    init: function() {
        this.cacheElements();
        this.setupEventListeners();
    },
    
    // Mettre en cache les éléments
    cacheElements: function() {
        this.elements = {
            form: document.getElementById('login-form') || document.getElementById('register-form'),
            username: document.getElementById('username'),
            email: document.getElementById('email'),
            displayName: document.getElementById('display_name'),
            password: document.getElementById('password'),
            confirmPassword: document.getElementById('confirm_password'),
            remember: document.getElementById('remember'),
            terms: document.getElementById('terms'),
            errorDiv: document.getElementById('login-error') || document.getElementById('register-error'),
            togglePassword: document.querySelectorAll('.toggle-password'),
            passwordStrength: document.getElementById('password-strength')
        };
    },
    
    // Configurer les écouteurs d'événements
    setupEventListeners: function() {
        // Soumission du formulaire
        if (this.elements.form) {
            this.elements.form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
        
        // Toggle mot de passe
        this.elements.togglePassword.forEach(btn => {
            btn.addEventListener('click', () => this.togglePasswordVisibility(btn));
        });
        
        // Force du mot de passe
        if (this.elements.password && this.elements.passwordStrength) {
            this.elements.password.addEventListener('input', () => this.checkPasswordStrength());
        }
        
        // Validation en temps réel
        if (this.elements.username) {
            let checkTimeout = null;
            this.elements.username.addEventListener('input', () => {
                if (checkTimeout) clearTimeout(checkTimeout);
                checkTimeout = setTimeout(() => this.validateUsername(), 500);
            });
        }
        
        if (this.elements.password) {
            this.elements.password.addEventListener('blur', () => this.validatePassword());
        }
    },
    
    // Gérer la soumission du formulaire
    handleSubmit: async function(e) {
        e.preventDefault();
        
        const formData = new FormData(this.elements.form);
        const isLogin = this.elements.form.id === 'login-form';
        
        // Validation côté client
        if (!this.validateForm(isLogin)) {
            return;
        }
        
        const submitBtn = this.elements.form.querySelector('button[type="submit"]');
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;
        
        try {
            const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(Object.fromEntries(formData))
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Connexion réussie
                this.showNotification('Connexion réussie! Redirection...', 'success');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);
            } else {
                // Erreur
                this.showError(data.error || 'Une erreur est survenue');
            }
        } catch (error) {
            console.error('[Auth] Erreur:', error);
            this.showError('Erreur de connexion au serveur');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    },
    
    // Valider le formulaire
    validateForm: function(isLogin) {
        // Réinitialiser les erreurs
        this.clearErrors();
        
        let isValid = true;
        
        // Validation du nom d'utilisateur
        if (!this.elements.username.value.trim()) {
            this.showFieldError(this.elements.username, 'Le nom d\'utilisateur est requis');
            isValid = false;
        } else if (this.elements.username.value.length < 3) {
            this.showFieldError(this.elements.username, 'Le nom d\'utilisateur doit contenir au moins 3 caractères');
            isValid = false;
        } else if (!/^[a-zA-Z0-9_]+$/.test(this.elements.username.value)) {
            this.showFieldError(this.elements.username, 'Le nom d\'utilisateur ne peut contenir que des lettres, chiffres et _');
            isValid = false;
        }
        
        // Validation de l'email (inscription uniquement)
        if (!isLogin) {
            if (!this.elements.email.value.trim()) {
                this.showFieldError(this.elements.email, 'L\'adresse email est requise');
                isValid = false;
            } else if (!this.isValidEmail(this.elements.email.value)) {
                this.showFieldError(this.elements.email, 'Adresse email invalide');
                isValid = false;
            }
        }
        
        // Validation du mot de passe
        if (!this.elements.password.value) {
            this.showFieldError(this.elements.password, 'Le mot de passe est requis');
            isValid = false;
        } else if (!isLogin && this.elements.password.value.length < 8) {
            this.showFieldError(this.elements.password, 'Le mot de passe doit contenir au moins 8 caractères');
            isValid = false;
        }
        
        // Confirmation du mot de passe (inscription uniquement)
        if (!isLogin && this.elements.confirmPassword) {
            if (this.elements.password.value !== this.elements.confirmPassword.value) {
                this.showFieldError(this.elements.confirmPassword, 'Les mots de passe ne correspondent pas');
                isValid = false;
            }
        }
        
        // Conditions d'utilisation (inscription uniquement)
        if (!isLogin && this.elements.terms && !this.elements.terms.checked) {
            this.showError('Vous devez accepter les conditions d\'utilisation');
            isValid = false;
        }
        
        return isValid;
    },
    
    // Valider le nom d'utilisateur
    validateUsername: async function() {
        const username = this.elements.username.value.trim();
        const statusEl = document.getElementById('username-status');
        const errorEl = document.getElementById('username-error-msg');
        const suggestionsEl = document.getElementById('username-suggestions');
        const suggestionsList = suggestionsEl?.querySelector('.suggestions-list');

        if (!username || username.length < 3) {
            if (statusEl) statusEl.innerHTML = '';
            if (errorEl) errorEl.style.display = 'none';
            if (suggestionsEl) suggestionsEl.style.display = 'none';
            return;
        }

        if (statusEl) statusEl.innerHTML = '⏳';

        try {
            const response = await fetch('/api/auth/check-nickname', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();

            if (statusEl) {
                if (!data.valid) {
                    statusEl.innerHTML = '❌';
                    if (errorEl) {
                        errorEl.textContent = data.error;
                        errorEl.style.display = 'block';
                    }
                } else if (!data.available) {
                     statusEl.innerHTML = '👥';
                     if (errorEl) {
                         const firstSug = data.suggestions && data.suggestions[0];
                         errorEl.innerHTML = `
                             ${data.error} 
                             ${firstSug ? `<a href="#" class="apply-sug" style="color: var(--accent); margin-left: 5px; text-decoration: underline;">Appliquer "${firstSug}" ?</a>` : ''}
                         `;
                         errorEl.style.display = 'block';

                         const applyBtn = errorEl.querySelector('.apply-sug');
                         if (applyBtn) {
                             applyBtn.onclick = (e) => {
                                 e.preventDefault();
                                 this.elements.username.value = firstSug;
                                 this.validateUsername();
                             };
                         }
                     }
                     
                     // Afficher les suggestions
                     if (data.suggestions && data.suggestions.length > 0 && suggestionsList) {
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
                                display: inline-block;
                                margin: 2px;
                            `;
                            badge.onclick = () => {
                                this.elements.username.value = sug;
                                suggestionsEl.style.display = 'none';
                                this.validateUsername();
                            };
                            badge.onmouseenter = () => badge.style.transform = 'scale(1.05)';
                            badge.onmouseleave = () => badge.style.transform = 'scale(1)';
                            suggestionsList.appendChild(badge);
                        });
                        suggestionsEl.style.display = 'block';
                    }
                } else {
                    statusEl.innerHTML = '✅';
                    if (errorEl) errorEl.style.display = 'none';
                    if (suggestionsEl) suggestionsEl.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('[Auth] Erreur validation username:', error);
            if (statusEl) statusEl.innerHTML = '⚠️';
        }
    },
    
    // Valider le mot de passe
    validatePassword: function() {
        if (!this.elements.password.value) {
            return;
        }
        
        // La validation de force est déjà faite par checkPasswordStrength
    },
    
    // Vérifier la force du mot de passe
    checkPasswordStrength: function() {
        const password = this.elements.password.value;
        const strengthBar = this.elements.passwordStrength;
        
        if (!password) {
            strengthBar.className = 'password-strength';
            return;
        }
        
        let strength = 0;
        
        // Longueur
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        
        // Variété de caractères
        if (/[a-z]/.test(password)) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^a-zA-Z0-9]/.test(password)) strength++;
        
        // Calculer la force
        if (strength <= 3) {
            strengthBar.className = 'password-strength weak';
        } else if (strength <= 5) {
            strengthBar.className = 'password-strength medium';
        } else {
            strengthBar.className = 'password-strength strong';
        }
    },
    
    // Basculer la visibilité du mot de passe
    togglePasswordVisibility: function(btn) {
        const input = btn.parentElement.querySelector('input');
        const svg = btn.querySelector('svg');
        
        if (input.type === 'password') {
            input.type = 'text';
            svg.innerHTML = `
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            `;
        } else {
            input.type = 'password';
            svg.innerHTML = `
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            `;
        }
    },
    
    // Afficher une erreur de champ
    showFieldError: function(field, message) {
        field.style.borderColor = '#ff3333';
        field.style.boxShadow = '0 0 0 3px rgba(255, 51, 51, 0.1)';
        
        // Créer ou mettre à jour le message d'erreur
        let errorEl = field.parentElement.querySelector('.field-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'field-error';
            errorEl.style.cssText = 'color: #ff3333; font-size: 11px; margin-top: 4px; font-family: "JetBrains Mono", monospace;';
            field.parentElement.appendChild(errorEl);
        }
        errorEl.textContent = message;
        
        // Effacer l'erreur au changement
        field.addEventListener('input', function clearError() {
            field.style.borderColor = '';
            field.style.boxShadow = '';
            if (errorEl) errorEl.remove();
            field.removeEventListener('input', clearError);
        }, { once: true });
    },
    
    // Effacer toutes les erreurs
    clearErrors: function() {
        // Effacer les erreurs de champ
        document.querySelectorAll('.field-error').forEach(el => el.remove());
        document.querySelectorAll('input').forEach(input => {
            input.style.borderColor = '';
            input.style.boxShadow = '';
        });
        
        // Effacer l'erreur principale
        if (this.elements.errorDiv) {
            this.elements.errorDiv.style.display = 'none';
            this.elements.errorDiv.textContent = '';
        }
    },
    
    // Afficher une erreur
    showError: function(message) {
        if (this.elements.errorDiv) {
            this.elements.errorDiv.textContent = message;
            this.elements.errorDiv.style.display = 'block';
            
            // Masquer après un délai
            setTimeout(() => {
                this.elements.errorDiv.style.display = 'none';
            }, 5000);
        } else {
            this.showNotification(message, 'error');
        }
    },
    
    // Afficher une notification
    showNotification: function(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        requestAnimationFrame(() => {
            notification.classList.add('show');
        });
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    },
    
    // Valider un email
    isValidEmail: function(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }
};

// Styles pour les notifications
const notificationStyles = `
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

// Ajouter les styles
const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);

// Démarrer l'authentification
document.addEventListener('DOMContentLoaded', () => Auth.init());
