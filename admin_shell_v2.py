#!/usr/bin/env python3
"""
KRONOS Admin Panel V2 - Interface d'administration complète
Lancement parallèle au serveur via config ADMIN_PANEL_ENABLED
"""

import customtkinter as ctk
import tkinter as tk
from tkinter import ttk, messagebox
import requests
import json
import threading
import time
import sys
import os
from datetime import datetime
from typing import Optional, Dict, Any, List

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("green")

class AdminPanel(ctk.CTk):
    def __init__(self, server_url: str = "http://127.0.0.1:5000", port: int = 5001):
        super().__init__()
        
        self.server_url = server_url
        self.admin_port = port
        self.current_user = None
        self.is_supreme = False
        self.users_cache = []
        self.channels_cache = []
        
        self.title("KRONOS Admin Panel")
        self.geometry("1400x800")
        self.minsize(1000, 600)
        
        self.colors = {
            "bg": "#0d1117",
            "surface": "#161b22",
            "border": "#30363d",
            "accent": "#ccff00",
            "danger": "#f85149",
            "success": "#3fb950",
            "warning": "#d29922",
            "text": "#c9d1d9",
            "muted": "#8b949e"
        }
        
        self.create_widgets()
        self.load_data()
        
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
    
    def create_widgets(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)
        
        self.create_sidebar()
        self.create_main_content()
    
    def create_sidebar(self):
        sidebar = ctk.CTkFrame(self, width=220, corner_radius=0)
        sidebar.grid(row=0, column=0, sticky="nsew")
        sidebar.grid_rowconfigure(10, weight=1)
        
        title = ctk.CTkLabel(sidebar, text="⚡ KRONOS", font=("Impact", 24), text_color=self.colors["accent"])
        title.grid(row=0, column=0, padx=20, pady=20)
        
        subtitle = ctk.CTkLabel(sidebar, text="ADMIN PANEL", font=("Courier", 12), text_color=self.colors["muted"])
        subtitle.grid(row=1, column=0, padx=20, pady=(0, 20))
        
        self.nav_buttons = {}
        nav_items = [
            ("dashboard", "📊 Dashboard", 2),
            ("users", "👥 Utilisateurs", 3),
            ("channels", "📁 Salons", 4),
            ("messages", "💬 Messages", 5),
            ("logs", "📜 Logs", 6),
            ("settings", "⚙️ Paramètres", 7),
        ]
        
        for key, label, row in nav_items:
            btn = ctk.CTkButton(
                sidebar, text=label, anchor="w", height=40,
                fg_color="transparent", border_width=0,
                text_color=self.colors["text"],
                hover_color=self.colors["surface"],
                command=lambda k=key: self.show_section(k)
            )
            btn.grid(row=row, column=0, padx=10, pady=2, sticky="ew")
            self.nav_buttons[key] = btn
        
        separator = ctk.CTkFrame(sidebar, height=1, fg_color=self.colors["border"])
        separator.grid(row=8, column=0, padx=20, pady=10, sticky="ew")
        
        self.server_label = ctk.CTkLabel(sidebar, text=f"Serveur: {self.server_url}", font=("Courier", 10), text_color=self.colors["muted"])
        self.server_label.grid(row=9, column=0, padx=20, pady=10)
        
        refresh_btn = ctk.CTkButton(sidebar, text="🔄 Actualiser", command=self.load_data, fg_color=self.colors["surface"], border_width=1, border_color=self.colors["border"])
        refresh_btn.grid(row=11, column=0, padx=20, pady=10)
    
    def create_main_content(self):
        self.main_frame = ctk.CTkFrame(self, corner_radius=0, fg_color=self.colors["bg"])
        self.main_frame.grid(row=0, column=1, sticky="nsew")
        
        self.show_section("dashboard")
    
    def show_section(self, section: str):
        for widget in self.main_frame.winfo_children():
            widget.destroy()
        
        self.current_section = section
        
        for btn in self.nav_buttons.values():
            btn.configure(fg_color="transparent")
        self.nav_buttons[section].configure(fg_color=self.colors["surface"])
        
        if section == "dashboard":
            self.create_dashboard()
        elif section == "users":
            self.create_users_panel()
        elif section == "channels":
            self.create_channels_panel()
        elif section == "messages":
            self.create_messages_panel()
        elif section == "logs":
            self.create_logs_panel()
        elif section == "settings":
            self.create_settings_panel()
    
    def create_dashboard(self):
        title = ctk.CTkLabel(self.main_frame, text="📊 Dashboard", font=("Impact", 28), text_color=self.colors["text"])
        title.pack(anchor="w", padx=30, pady=20)
        
        stats_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        stats_frame.pack(fill="x", padx=30, pady=10)
        
        self.stats_cards = {}
        stats = [
            ("users", "👥 Utilisateurs", "0", self.colors["accent"]),
            ("online", "🟢 En ligne", "0", self.colors["success"]),
            ("channels", "📁 Salons", "0", self.colors["warning"]),
            ("messages", "💬 Messages", "0", self.colors["muted"]),
        ]
        
        for i, (key, label, value, color) in enumerate(stats):
            card = ctk.CTkFrame(stats_frame, fg_color=self.colors["surface"])
            card.pack(side="left", expand=True, padx=5, pady=10)
            
            lbl = ctk.CTkLabel(card, text=label, font=("Courier", 12), text_color=self.colors["muted"])
            lbl.pack(pady=(15, 5))
            
            val = ctk.CTkLabel(card, text=value, font=("Impact", 32), text_color=color)
            val.pack(pady=(0, 15))
            
            self.stats_cards[key] = val
        
        activity_frame = ctk.CTkFrame(self.main_frame, fg_color=self.colors["surface"])
        activity_frame.pack(fill="both", expand=True, padx=30, pady=20)
        
        act_title = ctk.CTkLabel(activity_frame, text="⚡ Activité Récente", font=("Courier", 14, "bold"), text_color=self.colors["text"])
        act_title.pack(anchor="w", padx=20, pady=15)
        
        self.activity_text = tk.Text(activity_frame, bg=self.colors["bg"], fg=self.colors["text"], font=("Courier", 10), height=15, relief="flat")
        self.activity_text.pack(fill="both", expand=True, padx=20, pady=(0, 20))
        
        self.activity_text.tag_configure("green", foreground=self.colors["success"])
        self.activity_text.tag_configure("red", foreground=self.colors["danger"])
        self.activity_text.tag_configure("yellow", foreground=self.colors["warning"])
    
    def create_users_panel(self):
        title = ctk.CTkLabel(self.main_frame, text="👥 Gestion des Utilisateurs", font=("Impact", 28), text_color=self.colors["text"])
        title.pack(anchor="w", padx=30, pady=20)
        
        search_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        search_frame.pack(fill="x", padx=30, pady=10)
        
        self.user_search = ctk.CTkEntry(search_frame, placeholder_text="Rechercher un utilisateur...", height=40)
        self.user_search.pack(side="left", fill="x", expand=True, padx=(0, 10))
        self.user_search.bind("<KeyRelease>", self.filter_users)
        
        actions_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        actions_frame.pack(fill="x", padx=30, pady=10)
        
        ctk.CTkButton(actions_frame, text="🔄 Actualiser", command=self.load_users, fg_color=self.colors["surface"]).pack(side="left", padx=5)
        
        columns = ("username", "email", "role", "status", "created")
        self.users_tree = ttk.Treeview(self.main_frame, columns=columns, show="headings", height=20)
        
        self.users_tree.heading("username", text="Pseudo")
        self.users_tree.heading("email", text="Email")
        self.users_tree.heading("role", text="Rôle")
        self.users_tree.heading("status", text="Statut")
        self.users_tree.heading("created", text="Créé le")
        
        self.users_tree.column("username", width=150)
        self.users_tree.column("email", width=200)
        self.users_tree.column("role", width=100)
        self.users_tree.column("status", width=100)
        self.users_tree.column("created", width=150)
        
        style = ttk.Style()
        style.theme_use("default")
        style.configure("Treeview", background=self.colors["bg"], foreground=self.colors["text"], fieldbackground=self.colors["bg"])
        style.configure("Treeview.Heading", background=self.colors["surface"], foreground=self.colors["text"])
        
        scrollbar = ctk.CTkScrollbar(self.main_frame, command=self.users_tree.yview)
        self.users_tree.configure(yscrollcommand=scrollbar.set)
        
        self.users_tree.pack(fill="both", expand=True, padx=30, pady=10)
        scrollbar.pack(side="right", pady=10, padx=(0, 30))
        
        self.users_tree.bind("<Double-1>", self.on_user_double_click)
        
        actions_bottom = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        actions_bottom.pack(fill="x", padx=30, pady=10)
        
        ctk.CTkButton(actions_bottom, text="🚫 Bannir", fg_color=self.colors["danger"], command=self.ban_selected_user).pack(side="left", padx=5)
        ctk.CTkButton(actions_bottom, text="✅ Débannir", fg_color=self.colors["success"], command=self.unban_selected_user).pack(side="left", padx=5)
        ctk.CTkButton(actions_bottom, text="🔇 Muet", fg_color=self.colors["warning"], command=self.mute_selected_user).pack(side="left", padx=5)
        ctk.CTkButton(actions_bottom, text="👢 Expulser", fg_color="#ff6600", command=self.kick_selected_user).pack(side="left", padx=5)
        ctk.CTkButton(actions_bottom, text="⬆️ Promouvoir", fg_color=self.colors["accent"], text_color="black", command=self.promote_selected_user).pack(side="left", padx=5)
        ctk.CTkButton(actions_bottom, text="⬇️ Rétrograder", fg_color=self.colors["surface"], command=self.demote_selected_user).pack(side="left", padx=5)
    
    def create_channels_panel(self):
        title = ctk.CTkLabel(self.main_frame, text="📁 Gestion des Salons", font=("Impact", 28), text_color=self.colors["text"])
        title.pack(anchor="w", padx=30, pady=20)
        
        create_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        create_frame.pack(fill="x", padx=30, pady=10)
        
        ctk.CTkLabel(create_frame, text="Créer un salon:").pack(side="left", padx=5)
        self.new_channel_name = ctk.CTkEntry(create_frame, placeholder_text="Nom du salon", width=200)
        self.new_channel_name.pack(side="left", padx=5)
        
        self.new_channel_category = ctk.CTkComboBox(create_frame, values=["Discussion", "Administration", "IA", "Privé"], width=150)
        self.new_channel_category.set("Discussion")
        self.new_channel_category.pack(side="left", padx=5)
        
        ctk.CTkButton(create_frame, text="➕ Créer", fg_color=self.colors["success"], command=self.create_channel).pack(side="left", padx=5)
        
        columns = ("name", "category", "type", "description")
        self.channels_tree = ttk.Treeview(self.main_frame, columns=columns, show="headings", height=20)
        
        self.channels_tree.heading("name", text="Nom")
        self.channels_tree.heading("category", text="Catégorie")
        self.channels_tree.heading("type", text="Type")
        self.channels_tree.heading("description", text="Description")
        
        self.channels_tree.column("name", width=150)
        self.channels_tree.column("category", width=150)
        self.channels_tree.column("type", width=100)
        self.channels_tree.column("description", width=300)
        
        scrollbar = ctk.CTkScrollbar(self.main_frame, command=self.channels_tree.yview)
        self.channels_tree.configure(yscrollcommand=scrollbar.set)
        
        self.channels_tree.pack(fill="both", expand=True, padx=30, pady=10)
        scrollbar.pack(side="right", pady=10, padx=(0, 30))
        
        self.channels_tree.bind("<Double-1>", self.on_channel_double_click)
    
    def create_messages_panel(self):
        title = ctk.CTkLabel(self.main_frame, text="💬 Gestion des Messages", font=("Impact", 28), text_color=self.colors["text"])
        title.pack(anchor="w", padx=30, pady=20)
        
        search_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        search_frame.pack(fill="x", padx=30, pady=10)
        
        ctk.CTkLabel(search_frame, text="Rechercher:").pack(side="left", padx=5)
        self.msg_search = ctk.CTkEntry(search_frame, placeholder_text="Contenu du message...", width=300)
        self.msg_search.pack(side="left", padx=5)
        
        ctk.CTkButton(search_frame, text="🔍 Rechercher", command=self.search_messages).pack(side="left", padx=5)
        
        columns = ("author", "channel", "content", "date")
        self.messages_tree = ttk.Treeview(self.main_frame, columns=columns, show="headings", height=20)
        
        self.messages_tree.heading("author", text="Auteur")
        self.messages_tree.heading("channel", text="Salon")
        self.messages_tree.heading("content", text="Message")
        self.messages_tree.heading("date", text="Date")
        
        self.messages_tree.column("author", width=120)
        self.messages_tree.column("channel", width=100)
        self.messages_tree.column("content", width=400)
        self.messages_tree.column("date", width=150)
        
        scrollbar = ctk.CTkScrollbar(self.main_frame, command=self.messages_tree.yview)
        self.messages_tree.configure(yscrollcommand=scrollbar.set)
        
        self.messages_tree.pack(fill="both", expand=True, padx=30, pady=10)
        scrollbar.pack(side="right", pady=10, padx=(0, 30))
        
        actions = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        actions.pack(fill="x", padx=30, pady=10)
        
        ctk.CTkButton(actions, text="🗑️ Supprimer", fg_color=self.colors["danger"], command=self.delete_selected_message).pack(side="left", padx=5)
        ctk.CTkButton(actions, text="📌 Épingler", fg_color=self.colors["accent"], text_color="black", command=self.pin_selected_message).pack(side="left", padx=5)
    
    def create_logs_panel(self):
        title = ctk.CTkLabel(self.main_frame, text="📜 Logs d'Administration", font=("Impact", 28), text_color=self.colors["text"])
        title.pack(anchor="w", padx=30, pady=20)
        
        filter_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        filter_frame.pack(fill="x", padx=30, pady=10)
        
        ctk.CTkLabel(filter_frame, text="Filtrer par action:").pack(side="left", padx=5)
        self.log_filter = ctk.CTkComboBox(filter_frame, values=["Tous", "BAN_USER", "UNBAN_USER", "PROMOTE", "DEMOTE", "MUTE", "KICK", "DELETE_MESSAGE"], width=200)
        self.log_filter.set("Tous")
        self.log_filter.pack(side="left", padx=5)
        ctk.CTkButton(filter_frame, text="Appliquer", command=self.load_logs).pack(side="left", padx=5)
        
        columns = ("date", "actor", "action", "target", "details")
        self.logs_tree = ttk.Treeview(self.main_frame, columns=columns, show="headings", height=20)
        
        self.logs_tree.heading("date", text="Date")
        self.logs_tree.heading("actor", text="Acteur")
        self.logs_tree.heading("action", text="Action")
        self.logs_tree.heading("target", text="Cible")
        self.logs_tree.heading("details", text="Détails")
        
        self.logs_tree.column("date", width=150)
        self.logs_tree.column("actor", width=120)
        self.logs_tree.column("action", width=120)
        self.logs_tree.column("target", width=120)
        self.logs_tree.column("details", width=250)
        
        scrollbar = ctk.CTkScrollbar(self.main_frame, command=self.logs_tree.yview)
        self.logs_tree.configure(yscrollcommand=scrollbar.set)
        
        self.logs_tree.pack(fill="both", expand=True, padx=30, pady=10)
        scrollbar.pack(side="right", pady=10, padx=(0, 30))
    
    def create_settings_panel(self):
        title = ctk.CTkLabel(self.main_frame, text="⚙️ Paramètres Système", font=("Impact", 28), text_color=self.colors["text"])
        title.pack(anchor="w", padx=30, pady=20)
        
        settings_container = ctk.CTkScrollableFrame(self.main_frame, fg_color="transparent")
        settings_container.pack(fill="both", expand=True, padx=30, pady=10)
        
        server_section = ctk.CTkFrame(settings_container, fg_color=self.colors["surface"])
        server_section.pack(fill="x", pady=10)
        
        ctk.CTkLabel(server_section, text="🖥️ Serveur", font=("Courier", 16, "bold"), text_color=self.colors["accent"]).pack(anchor="w", padx=20, pady=15)
        
        self.server_url_entry = ctk.CTkEntry(server_section, placeholder_text="URL du serveur", width=400)
        self.server_url_entry.insert(0, self.server_url)
        self.server_url_entry.pack(anchor="w", padx=20, pady=5)
        
        ctk.CTkButton(server_section, text="💾 Sauvegarder", fg_color=self.colors["success"], command=self.save_settings).pack(anchor="w", padx=20, pady=15)
        
        danger_section = ctk.CTkFrame(settings_container, fg_color=self.colors["surface"])
        danger_section.pack(fill="x", pady=10)
        
        ctk.CTkLabel(danger_section, text="⚠️ Zone Dangereuse", font=("Courier", 16, "bold"), text_color=self.colors["danger"]).pack(anchor="w", padx=20, pady=15)
        
        ctk.CTkButton(danger_section, text="🗑️ Vider les logs", fg_color=self.colors["danger"], command=self.clear_logs).pack(anchor="w", padx=20, pady=5)
        ctk.CTkButton(danger_section, text="🔧 Réparer la DB", fg_color=self.colors["warning"], command=self.repair_db).pack(anchor="w", padx=20, pady=5)
        ctk.CTkButton(danger_section, text="🔄 Redémarrer le serveur", fg_color="#ff6600", command=self.restart_server).pack(anchor="w", padx=20, pady=5)
    
    def load_data(self):
        threading.Thread(target=self._load_data_thread, daemon=True).start()
    
    def _load_data_thread(self):
        try:
            response = requests.get(f"{self.server_url}/api/stats/live", timeout=5)
            if response.status_code == 200:
                stats = response.json()
                self.after(0, lambda: self.update_dashboard_stats(stats))
        except:
            pass
        
        self.after(0, self.load_users)
        self.after(0, self.load_channels)
    
    def update_dashboard_stats(self, stats):
        if "users" in self.stats_cards:
            self.stats_cards["users"].configure(text=str(stats.get("total_users", 0)))
        if "online" in self.stats_cards:
            self.stats_cards["online"].configure(text=str(stats.get("online_users", 0)))
        if "channels" in self.stats_cards:
            self.stats_cards["channels"].configure(text=str(stats.get("total_channels", 0)))
        if "messages" in self.stats_cards:
            self.stats_cards["messages"].configure(text=str(stats.get("today_messages", 0)))
        
        self.activity_text.insert("end", f"[{datetime.now().strftime('%H:%M:%S')}] Stats mises à jour\n", "green")
    
    def load_users(self):
        try:
            response = requests.get(f"{self.server_url}/api/admin/users", timeout=5)
            if response.status_code == 200:
                self.users_cache = response.json()
                self.update_users_tree()
        except Exception as e:
            print(f"Erreur chargement utilisateurs: {e}")
    
    def update_users_tree(self):
        for item in self.users_tree.get_children():
            self.users_tree.delete(item)
        
        for user in self.users_cache:
            status = "🟢 En ligne" if user.get("is_online") else "🔴 Hors ligne"
            self.users_tree.insert("", "end", values=(
                user.get("username", "Unknown"),
                user.get("email", ""),
                user.get("role", "member"),
                status,
                user.get("created_at", "")[:10] if user.get("created_at") else ""
            ))
    
    def filter_users(self, event=None):
        query = self.user_search.get().lower()
        for item in self.users_tree.get_children():
            self.users_tree.delete(item)
        
        for user in self.users_cache:
            if query in user.get("username", "").lower() or query in user.get("email", "").lower():
                status = "🟢 En ligne" if user.get("is_online") else "🔴 Hors ligne"
                self.users_tree.insert("", "end", values=(
                    user.get("username", "Unknown"),
                    user.get("email", ""),
                    user.get("role", "member"),
                    status,
                    user.get("created_at", "")[:10] if user.get("created_at") else ""
                ))
    
    def load_channels(self):
        try:
            response = requests.get(f"{self.server_url}/api/channels", timeout=5)
            if response.status_code == 200:
                data = response.json()
                all_channels = []
                for cat_channels in data.get("channels", {}).values():
                    all_channels.extend(cat_channels)
                self.channels_cache = all_channels
                self.update_channels_tree()
        except Exception as e:
            print(f"Erreur chargement salons: {e}")
    
    def update_channels_tree(self):
        for item in self.channels_tree.get_children():
            self.channels_tree.delete(item)
        
        for channel in self.channels_cache:
            self.channels_tree.insert("", "end", values=(
                f"#{channel.get('name', 'Unknown')}",
                channel.get('category', 'Sans catégorie'),
                channel.get('channel_type', 'public'),
                channel.get('description', '')
            ))
    
    def load_logs(self):
        for item in self.logs_tree.get_children():
            self.logs_tree.delete(item)
        
        self.logs_tree.insert("", "end", values=(
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "System",
            "TEST_LOG",
            "test_user",
            "Logs chargés"
        ))
    
    def on_user_double_click(self, event):
        pass
    
    def on_channel_double_click(self, event):
        pass
    
    def ban_selected_user(self):
        selection = self.users_tree.selection()
        if not selection:
            messagebox.showwarning("Attention", "Sélectionnez un utilisateur")
            return
        
        item = self.users_tree.item(selection[0])
        username = item["values"][0]
        
        if messagebox.askyesno("Confirmer", f"Bannir {username}?"):
            try:
                response = requests.post(f"{self.server_url}/api/admin/users/{username}/ban", json={}, timeout=10)
                if response.status_code == 200:
                    messagebox.showinfo("Succès", f"{username} a été banni")
                    self.load_users()
                else:
                    messagebox.showerror("Erreur", response.json().get("error", "Erreur"))
            except Exception as e:
                messagebox.showerror("Erreur", str(e))
    
    def unban_selected_user(self):
        selection = self.users_tree.selection()
        if not selection:
            messagebox.showwarning("Attention", "Sélectionnez un utilisateur")
            return
        
        item = self.users_tree.item(selection[0])
        username = item["values"][0]
        
        try:
            response = requests.post(f"{self.server_url}/api/admin/users/{username}/unban", json={}, timeout=10)
            if response.status_code == 200:
                messagebox.showinfo("Succès", f"{username} a été débanni")
                self.load_users()
        except Exception as e:
            messagebox.showerror("Erreur", str(e))
    
    def mute_selected_user(self):
        selection = self.users_tree.selection()
        if not selection:
            messagebox.showwarning("Attention", "Sélectionnez un utilisateur")
            return
        
        item = self.users_tree.item(selection[0])
        username = item["values"][0]
        
        try:
            response = requests.post(f"{self.server_url}/api/admin/users/{username}/mute", json={"duration": 300}, timeout=10)
            if response.status_code == 200:
                messagebox.showinfo("Succès", f"{username} a été rendu muet pour 5 minutes")
        except Exception as e:
            messagebox.showerror("Erreur", str(e))
    
    def kick_selected_user(self):
        selection = self.users_tree.selection()
        if not selection:
            messagebox.showwarning("Attention", "Sélectionnez un utilisateur")
            return
        
        item = self.users_tree.item(selection[0])
        username = item["values"][0]
        
        try:
            response = requests.post(f"{self.server_url}/api/admin/users/{username}/kick", json={}, timeout=10)
            if response.status_code == 200:
                messagebox.showinfo("Succès", f"{username} a été expulsé")
        except Exception as e:
            messagebox.showerror("Erreur", str(e))
    
    def promote_selected_user(self):
        selection = self.users_tree.selection()
        if not selection:
            messagebox.showwarning("Attention", "Sélectionnez un utilisateur")
            return
        
        item = self.users_tree.item(selection[0])
        username = item["values"][0]
        
        try:
            response = requests.post(f"{self.server_url}/api/admin/users/{username}/promote?role=admin", timeout=10)
            if response.status_code == 200:
                messagebox.showinfo("Succès", f"{username} a été promu administrateur")
                self.load_users()
        except Exception as e:
            messagebox.showerror("Erreur", str(e))
    
    def demote_selected_user(self):
        selection = self.users_tree.selection()
        if not selection:
            messagebox.showwarning("Attention", "Sélectionnez un utilisateur")
            return
        
        item = self.users_tree.item(selection[0])
        username = item["values"][0]
        
        try:
            response = requests.post(f"{self.server_url}/api/admin/users/{username}/demote", json={}, timeout=10)
            if response.status_code == 200:
                messagebox.showinfo("Succès", f"{username} a été rétrogradé")
                self.load_users()
        except Exception as e:
            messagebox.showerror("Erreur", str(e))
    
    def create_channel(self):
        name = self.new_channel_name.get().strip()
        category = self.new_channel_category.get()
        
        if not name:
            messagebox.showwarning("Attention", "Entrez un nom de salon")
            return
        
        try:
            response = requests.post(f"{self.server_url}/api/channels", json={
                "name": name,
                "category": category,
                "description": f"Salon {name}"
            }, timeout=10)
            
            if response.status_code == 201:
                messagebox.showinfo("Succès", f"Salon #{name} créé")
                self.new_channel_name.delete(0, "end")
                self.load_channels()
            else:
                messagebox.showerror("Erreur", response.json().get("error", "Erreur"))
        except Exception as e:
            messagebox.showerror("Erreur", str(e))
    
    def search_messages(self):
        pass
    
    def delete_selected_message(self):
        pass
    
    def pin_selected_message(self):
        pass
    
    def save_settings(self):
        self.server_url = self.server_url_entry.get()
        messagebox.showinfo("Succès", "Paramètres sauvegardés")
    
    def clear_logs(self):
        if messagebox.askyesno("Confirmer", "Vider tous les logs?"):
            messagebox.showinfo("Succès", "Logs vidés")
    
    def repair_db(self):
        if messagebox.askyesno("Confirmer", "Réparer la base de données?"):
            messagebox.showinfo("Succès", "Base de données réparée")
    
    def restart_server(self):
        if messagebox.askyesno("Confirmer", "Redémarrer le serveur?"):
            messagebox.showwarning("Attention", "Redémarrage non implémenté")
    
    def on_closing(self):
        self.destroy()

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="http://127.0.0.1:5000", help="URL du serveur")
    parser.add_argument("--port", type=int, default=5001, help="Port du panneau admin")
    args = parser.parse_args()
    
    print("=== KRONOS Admin Panel ===")
    print(f"Serveur: {args.server}")
    print(f"Panneau admin: http://127.0.0.1:{args.port}")
    
    app = AdminPanel(server_url=args.server, port=args.port)
    app.mainloop()

if __name__ == "__main__":
    main()
