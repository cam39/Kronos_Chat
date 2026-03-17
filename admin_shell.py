#!/usr/bin/env python3
"""
KRONOS Admin Shell - Interface d'administration avec CustomTkinter
Mode Local: Console + Terminal de commandes
Mode Distant: Surveillance uniquement
"""

import customtkinter as ctk
import tkinter as tk
from tkinter import scrolledtext, messagebox
import socketio
import requests
import json
import threading
import time
import sys
from datetime import datetime
from typing import Optional, Dict, Any

# Configuration du thème
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

class AdminShell(ctk.CTk):
    def __init__(self, remote_mode: bool = False, server_url: str = None):
        super().__init__()
        
        self.remote_mode = remote_mode
        self.server_url = server_url or "http://127.0.0.1:5000"
        self.is_supreme = False
        self.current_user = None
        
        # Socket.IO client
        self.sio = socketio.Client()
        
        # Configuration de la fenêtre
        self.title("KRONOS Admin Shell")
        self.geometry("1200x700")
        self.minsize(800, 600)
        
        # Configuration des couleurs Matrix/Terminal
        self.colors = {
            "bg": "#0a0a0a",
            "fg": "#00ff00",
            "fg_red": "#ff3333",
            "fg_yellow": "#ffff00",
            "fg_blue": "#00aaff",
            "fg_gray": "#cccccc",
            "border": "#333333",
            "console_bg": "#000000",
            "terminal_bg": "#0d1117"
        }
        
        # Initialisation
        self.setup_socket_events()
        self.create_widgets()
        self.setup_styles()
        
        # Connexion au serveur
        self.connect_to_server()
        
        # Gestion de la fermeture
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
    
    def setup_socket_events(self):
        """Configuration des événements Socket.IO"""
        
        @self.sio.event
        def connect():
            self.log_message("Connexion établie avec le serveur", "green")
            self.authenticate_admin()
        
        @self.sio.event
        def disconnect():
            self.log_message("Déconnecté du serveur", "red")
        
        @self.sio.event
        def connect_error(data):
            self.log_message(f"Erreur de connexion: {data}", "red")
        
        # Événements de modération
        @self.sio.on('user_banned')
        def on_user_banned(data):
            self.log_message(f"[BAN] {data.get('username', 'Unknown')} banni par {data.get('banned_by', 'Admin')}", "red")
        
        @self.sio.on('user_unbanned')
        def on_user_unbanned(data):
            self.log_message(f"[UNBAN] {data.get('username', 'Unknown')} débanni par {data.get('unbanned_by', 'Admin')}", "green")
        
        @self.sio.on('user_kicked')
        def on_user_kicked(data):
            self.log_message(f"[KICK] {data.get('username', 'Unknown')} expulsé par {data.get('kicked_by', 'Admin')}", "yellow")
        
        @self.sio.on('user_muted')
        def on_user_muted(data):
            self.log_message(f"[MUTE] {data.get('username', 'Unknown')} muté pour {data.get('duration', 'Unknown')}s", "yellow")
        
        @self.sio.on('user_shadowbanned')
        def on_user_shadowbanned(data):
            self.log_message(f"[SHADOWBAN] {data.get('username', 'Unknown')} shadowbanni par {data.get('banned_by', 'Admin')}", "red")
        
        # Événements de connexion
        @self.sio.on('user_connected')
        def on_user_connected(data):
            self.log_message(f"[CONNECT] {data.get('username', 'Unknown')} ({data.get('id', 'Unknown')})", "green")
        
        @self.sio.on('user_disconnected')
        def on_user_disconnected(data):
            self.log_message(f"[DISCONNECT] User {data.get('user_id', 'Unknown')}", "gray")
        
        # Messages système
        @self.sio.on('system_message')
        def on_system_message(data):
            self.log_message(f"[SYSTEM] {data.get('message', '')}", "blue")
    
    def create_widgets(self):
        """Création des widgets de l'interface"""
        
        # Frame principal
        self.main_frame = ctk.CTkFrame(self)
        self.main_frame.pack(fill="both", expand=True, padx=10, pady=10)
        
        # Barre de statut
        self.create_status_bar()
        
        # Panneau principal
        self.paned_window = ctk.CTkFrame(self.main_frame)
        self.paned_window.pack(fill="both", expand=True, pady=(10, 0))
        
        # Console de logs (gauche)
        self.create_console()
        
        # Terminal de commandes (droite) - seulement en mode local
        if not self.remote_mode:
            self.create_terminal()
        else:
            self.create_remote_info()
    
    def create_status_bar(self):
        """Création de la barre de statut"""
        status_frame = ctk.CTkFrame(self.main_frame, height=30)
        status_frame.pack(fill="x", pady=(0, 10))
        status_frame.pack_propagate(False)
        
        # Mode
        mode_text = "MODE DISTANT" if self.remote_mode else "MODE LOCAL"
        self.mode_label = ctk.CTkLabel(status_frame, text=mode_text, font=("Courier", 12, "bold"))
        self.mode_label.pack(side="left", padx=10, pady=5)
        
        # Serveur
        self.server_label = ctk.CTkLabel(status_frame, text=f"Serveur: {self.server_url}", font=("Courier", 10))
        self.server_label.pack(side="left", padx=10, pady=5)
        
        # Statut connexion
        self.status_label = ctk.CTkLabel(status_frame, text="🔴 Hors ligne", font=("Courier", 10))
        self.status_label.pack(side="right", padx=10, pady=5)
        
        # Rôle
        self.role_label = ctk.CTkLabel(status_frame, text="Rôle: Inconnu", font=("Courier", 10))
        self.role_label.pack(side="right", padx=10, pady=5)
    
    def create_console(self):
        """Création de la console de logs"""
        console_frame = ctk.CTkFrame(self.paned_window)
        console_frame.pack(side="left", fill="both", expand=True, padx=(0, 5))
        
        # Titre
        title_label = ctk.CTkLabel(console_frame, text="📡 CONSOLE LOGS", font=("Courier", 14, "bold"))
        title_label.pack(pady=10)
        
        # Console de logs
        self.console_text = tk.Text(
            console_frame,
            bg=self.colors["console_bg"],
            fg=self.colors["fg"],
            font=("Courier", 10),
            insertbackground=self.colors["fg"],
            relief="flat",
            bd=0
        )
        self.console_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        
        # Scrollbar
        console_scrollbar = ctk.CTkScrollbar(console_frame, command=self.console_text.yview)
        console_scrollbar.pack(side="right", fill="y")
        self.console_text.configure(yscrollcommand=console_scrollbar.set)
        
        # Configuration des tags pour les couleurs
        self.console_text.tag_configure("green", foreground=self.colors["fg"])
        self.console_text.tag_configure("red", foreground=self.colors["fg_red"])
        self.console_text.tag_configure("yellow", foreground=self.colors["fg_yellow"])
        self.console_text.tag_configure("blue", foreground=self.colors["fg_blue"])
        self.console_text.tag_configure("gray", foreground=self.colors["fg_gray"])
        
        # Message de bienvenue
        self.log_message("=== KRONOS Admin Shell ===", "green")
        self.log_message(f"Mode: {'DISTANT' if self.remote_mode else 'LOCAL'}", "blue")
        self.log_message(f"Serveur cible: {self.server_url}", "gray")
    
    def create_terminal(self):
        """Création du terminal de commandes (mode local)"""
        terminal_frame = ctk.CTkFrame(self.paned_window)
        terminal_frame.pack(side="right", fill="both", expand=True, padx=(5, 0))
        
        # Titre
        title_label = ctk.CTkLabel(terminal_frame, text="💻 TERMINAL COMMANDES", font=("Courier", 14, "bold"))
        title_label.pack(pady=10)
        
        # Zone de sortie terminal
        self.terminal_output = tk.Text(
            terminal_frame,
            bg=self.colors["terminal_bg"],
            fg=self.colors["fg"],
            font=("Courier", 10),
            insertbackground=self.colors["fg"],
            relief="flat",
            bd=0,
            height=15
        )
        self.terminal_output.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        
        # Scrollbar pour la sortie
        terminal_scrollbar = ctk.CTkScrollbar(terminal_frame, command=self.terminal_output.yview)
        terminal_scrollbar.pack(side="right", fill="y")
        self.terminal_output.configure(yscrollcommand=terminal_scrollbar.set)
        
        # Configuration des tags
        self.terminal_output.tag_configure("output", foreground=self.colors["fg"])
        self.terminal_output.tag_configure("error", foreground=self.colors["fg_red"])
        self.terminal_output.tag_configure("success", foreground=self.colors["fg"])
        
        # Zone d'entrée
        input_frame = ctk.CTkFrame(terminal_frame)
        input_frame.pack(fill="x", padx=10, pady=(0, 10))
        
        # Prompt
        prompt_label = ctk.CTkLabel(input_frame, text="$", font=("Courier", 12, "bold"))
        prompt_label.pack(side="left", padx=(5, 5))
        
        # Champ de commande
        self.command_entry = ctk.CTkEntry(
            input_frame,
            font=("Courier", 11),
            placeholder_text="Entrez une commande (help pour l'aide)",
            border_width=1,
            border_color=self.colors["border"]
        )
        self.command_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))
        self.command_entry.bind("<Return>", self.execute_command)
        
        # Message d'aide initial
        self.terminal_output.insert("end", "Terminal de commandes KRONOS\n", "output")
        self.terminal_output.insert("end", "Tapez 'help' pour voir les commandes disponibles\n", "output")
        self.terminal_output.insert("end", "$ ", "output")
    
    def create_remote_info(self):
        """Création du panneau d'information (mode distant)"""
        remote_frame = ctk.CTkFrame(self.paned_window)
        remote_frame.pack(side="right", fill="both", expand=True, padx=(5, 0))
        
        # Titre
        title_label = ctk.CTkLabel(remote_frame, text="🔭 MODE SURVEILLANCE", font=("Courier", 14, "bold"))
        title_label.pack(pady=20)
        
        # Information
        info_text = tk.Text(
            remote_frame,
            bg=self.colors["terminal_bg"],
            fg=self.colors["fg_gray"],
            font=("Courier", 11),
            relief="flat",
            bd=0,
            wrap="word",
            height=10
        )
        info_text.pack(fill="both", expand=True, padx=20, pady=20)
        info_text.insert("1.0", 
            "MODE DISTANT - SURVEILLANCE SEULEMENT\n\n"
            "Ce mode permet de surveiller les logs du serveur à distance.\n"
            "Les commandes d'administration sont désactivées.\n\n"
            "Pour accéder au terminal de commandes:\n"
            "1. Lancez l'outil depuis le serveur (mode local)\n"
            "2. Connectez-vous avec un compte Supreme\n\n"
            "Connexion en cours..."
        )
        info_text.configure(state="disabled")
    
    def setup_styles(self):
        """Configuration des styles"""
        self.configure(fg_color=self.colors["bg"])
        
        # Style pour tous les frames
        for widget in self.winfo_children():
            if isinstance(widget, ctk.CTkFrame):
                widget.configure(fg_color=self.colors["console_bg"])
    
    def connect_to_server(self):
        """Connexion au serveur Socket.IO"""
        try:
            self.log_message(f"Tentative de connexion à {self.server_url}...", "yellow")
            self.sio.connect(self.server_url)
        except Exception as e:
            self.log_message(f"Impossible de se connecter: {e}", "red")
            if self.remote_mode:
                self.show_connection_dialog()
    
    def show_connection_dialog(self):
        """Dialogue de connexion pour le mode distant"""
        dialog = ctk.CTkInputDialog(
            text="Entrez l'adresse du serveur (ex: 127.0.0.1:5000)",
            title="Connexion au serveur"
        )
        
        result = dialog.get_input()
        if result:
            self.server_url = f"http://{result}"
            self.server_label.configure(text=f"Serveur: {self.server_url}")
            self.connect_to_server()
    
    def authenticate_admin(self):
        """Authentification de l'administrateur"""
        try:
            # Vérifier le rôle de l'utilisateur via API
            response = requests.get(f"{self.server_url}/api/admin/check", timeout=5)
            if response.status_code == 200:
                data = response.json()
                self.current_user = data.get('user')
                self.is_supreme = data.get('is_supreme', False)
                
                role = "Supreme" if self.is_supreme else data.get('role', 'Unknown')
                self.role_label.configure(text=f"Rôle: {role}")
                self.status_label.configure(text="🟢 En ligne")
                
                if self.is_supreme:
                    self.log_message(f"Authentifié en tant que {role} - Accès complet", "green")
                else:
                    self.log_message(f"Authentifié en tant que {role} - Accès limité", "yellow")
                    if not self.remote_mode:
                        self.disable_terminal()
            else:
                self.log_message("Échec de l'authentification", "red")
                self.status_label.configure(text="🔴 Non authentifié")
        except Exception as e:
            self.log_message(f"Erreur d'authentification: {e}", "red")
    
    def disable_terminal(self):
        """Désactiver le terminal si pas Supreme"""
        if hasattr(self, 'command_entry'):
            self.command_entry.configure(state="disabled")
            self.terminal_output.insert("end", "\n⚠️ Accès terminal refusé - Rôle Supreme requis\n", "error")
    
    def log_message(self, message: str, color: str = "gray"):
        """Ajouter un message dans la console"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        formatted_message = f"[{timestamp}] {message}\n"
        
        self.console_text.insert("end", formatted_message, color)
        self.console_text.see("end")
        
        # Limiter le nombre de lignes pour éviter la surcharge
        lines = int(self.console_text.index('end-1c').split('.')[0])
        if lines > 1000:
            self.console_text.delete('1.0', '100.0')
    
    def execute_command(self, event=None):
        """Exécuter une commande du terminal"""
        if not hasattr(self, 'command_entry') or not self.is_supreme:
            return
        
        command = self.command_entry.get().strip()
        if not command:
            return
        
        # Afficher la commande
        self.terminal_output.insert("end", f"{command}\n", "output")
        
        # Traiter la commande
        parts = command.split()
        cmd = parts[0].lower()
        
        if cmd == "help":
            self.show_help()
        elif cmd == "clear":
            self.clear_terminal()
        elif cmd == "list":
            self.list_users()
        elif cmd == "ban" and len(parts) > 1:
            self.ban_user(parts[1])
        elif cmd == "unban" and len(parts) > 1:
            self.unban_user(parts[1])
        elif cmd == "shadowban" and len(parts) > 1:
            self.shadowban_user(parts[1])
        elif cmd == "mute" and len(parts) > 2:
            try:
                duration = int(parts[2])
                self.mute_user(parts[1], duration)
            except ValueError:
                self.terminal_output.insert("end", "Erreur: Durée invalide\n", "error")
        elif cmd == "kick" and len(parts) > 1:
            self.kick_user(parts[1])
        elif cmd == "info" and len(parts) > 1:
            self.get_user_info(parts[1])
        else:
            self.terminal_output.insert("end", f"Commande inconnue: {cmd}\n", "error")
            self.terminal_output.insert("end", "Tapez 'help' pour voir les commandes\n", "error")
        
        # Nouveau prompt
        self.terminal_output.insert("end", "$ ", "output")
        self.terminal_output.see("end")
        
        # Vider le champ
        self.command_entry.delete(0, "end")
    
    def show_help(self):
        """Afficher l'aide des commandes"""
        help_text = """
Commandes disponibles:
  help                    - Afficher cette aide
  clear                   - Nettoyer le terminal
  list                    - Lister les utilisateurs connectés
  ban <pseudo>            - Bannir un utilisateur
  unban <pseudo>          - Débannir un utilisateur
  shadowban <pseudo>      - Shadowbannir un utilisateur
  mute <pseudo> <temps>   - Rendre muet (temps en secondes)
  kick <pseudo>           - Expulser un utilisateur
  info <pseudo>           - Informations sur un utilisateur
"""
        self.terminal_output.insert("end", help_text, "output")
    
    def clear_terminal(self):
        """Nettoyer le terminal"""
        self.terminal_output.delete("1.0", "end")
        self.terminal_output.insert("end", "Terminal nettoyé\n", "success")
    
    def list_users(self):
        """Lister les utilisateurs connectés"""
        try:
            response = requests.get(f"{self.server_url}/api/admin/users", timeout=5)
            if response.status_code == 200:
                users = response.json()
                self.terminal_output.insert("end", f"\nUtilisateurs connectés ({len(users)}):\n", "success")
                for user in users:
                    status = "🟢" if user.get('is_online') else "🔴"
                    role = user.get('role', 'member')
                    self.terminal_output.insert("end", 
                        f"  {status} {user.get('username', 'Unknown')} [{role}]\n", "output")
                self.terminal_output.insert("end", "\n", "output")
            else:
                self.terminal_output.insert("end", "Erreur: Impossible de récupérer la liste\n", "error")
        except Exception as e:
            self.terminal_output.insert("end", f"Erreur: {e}\n", "error")
    
    def ban_user(self, username: str):
        """Bannir un utilisateur"""
        self.execute_moderation_command("ban", username)
    
    def unban_user(self, username: str):
        """Débannir un utilisateur"""
        self.execute_moderation_command("unban", username)
    
    def shadowban_user(self, username: str):
        """Shadowbannir un utilisateur"""
        self.execute_moderation_command("shadowban", username)
    
    def mute_user(self, username: str, duration: int):
        """Rendre muet un utilisateur"""
        self.execute_moderation_command("mute", username, duration)
    
    def kick_user(self, username: str):
        """Expulser un utilisateur"""
        self.execute_moderation_command("kick", username)
    
    def get_user_info(self, username: str):
        """Obtenir les informations d'un utilisateur"""
        try:
            response = requests.get(f"{self.server_url}/api/admin/user/{username}", timeout=5)
            if response.status_code == 200:
                user = response.json()
                info_text = f"""
Informations utilisateur:
  Pseudo: {user.get('username', 'Unknown')}
  ID: {user.get('id', 'Unknown')}
  Rôle: {user.get('role', 'Unknown')}
  Statut: {'En ligne' if user.get('is_online') else 'Hors ligne'}
  Email: {user.get('email', 'Non spécifié')}
  Créé le: {user.get('created_at', 'Unknown')}
"""
                self.terminal_output.insert("end", info_text, "output")
            else:
                self.terminal_output.insert("end", f"Utilisateur '{username}' non trouvé\n", "error")
        except Exception as e:
            self.terminal_output.insert("end", f"Erreur: {e}\n", "error")
    
    def execute_moderation_command(self, action: str, username: str, duration: int = None):
        """Exécuter une commande de modération"""
        try:
            data = {"username": username}
            if duration:
                data["duration"] = duration
            
            response = requests.post(
                f"{self.server_url}/api/admin/{action}",
                json=data,
                timeout=5
            )
            
            if response.status_code == 200:
                result = response.json()
                self.terminal_output.insert("end", f"✅ {result.get('message', 'Action réussie')}\n", "success")
            else:
                error = response.json().get('error', 'Action échouée')
                self.terminal_output.insert("end", f"❌ {error}\n", "error")
        except Exception as e:
            self.terminal_output.insert("end", f"Erreur: {e}\n", "error")
    
    def on_closing(self):
        """Gestion de la fermeture de l'application"""
        try:
            self.sio.disconnect()
        except:
            pass
        self.destroy()

def main():
    """Fonction principale"""
    # Vérifier si on est en mode distant
    remote_mode = "--remote" in sys.argv
    
    if remote_mode:
        # Mode distant - demander l'adresse du serveur
        print("=== KRONOS Admin Shell - Mode Distant ===")
        server_url = input("Entrez l'adresse du serveur (ex: 127.0.0.1:5000): ").strip()
        if not server_url:
            server_url = "127.0.0.1:5000"
        
        server_url = f"http://{server_url}"
    else:
        # Mode local
        server_url = "http://127.0.0.1:5000"
    
    # Créer et lancer l'interface
    app = AdminShell(remote_mode=remote_mode, server_url=server_url)
    app.mainloop()

if __name__ == "__main__":
    main()
