# KRONOS - Système de Communication Souverain
# Serveur Flask avec Socket.IO temps réel

import os
import json
import uuid
import shutil
import hashlib
import functools
from datetime import datetime, timedelta, timezone
import time
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for, session, flash
from flask_cors import CORS
from flask_login import login_user, logout_user, login_required, current_user
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
import random
import pathlib
from collections import deque
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import OperationalError, IntegrityError

# Décorateur personnalisé pour l'accès invité stylisé (Étape 8)
def guest_allowed(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for('guest_page', _external=False, _scheme=None))
        return f(*args, **kwargs)
    return decorated_function

# Importation des modules locaux
from config import *
from extensions import db, login_manager, mail
from flask_mail import Message as MailMessage
import threading
import smtplib
import socket # Ajouté pour détecter l'IP locale
import asyncio
from aiosmtpd.controller import Controller
from aiosmtpd.handlers import Sink
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# Détection de l'IP locale du serveur pour les exceptions d'administration
def get_server_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

SERVER_IP_ADDRESS = get_server_ip()
print(f"[KRONOS] IP du serveur détectée: {SERVER_IP_ADDRESS}")

# ============================================
# SERVEUR SMTP INTERNE (AUTO-HÉBERGÉ)
# ============================================
class KRONOSMailHandler:
    async def handle_DATA(self, server, session, envelope):
        print(f'[MAIL SERVER] Mail reçu de: {envelope.mail_from}')
        print(f'[MAIL SERVER] Pour: {envelope.rcpt_tos}')
        
        # Afficher le lien de reset directement dans la console
        content_str = envelope.content.decode('utf-8', errors='replace')
        import re
        links = re.findall(r'href=[\'"]?([^\'" >]+)', content_str)
        if links:
            print(f"[MAIL SERVER] 🔗 LIEN DÉTECTÉ : {links[0]}")
        
        # LOGIQUE DE RELAIS VERS LE FOURNISSEUR (SI CONFIGURÉ)
        if RELAY_HOST:
            print(f"[MAIL SERVER] Tentative de relais via {RELAY_HOST}...")
            try:
                import smtplib
                # Utilisation de smtplib pour relayer le message tel quel
                if RELAY_PORT == 465:
                    relay_server = smtplib.SMTP_SSL(RELAY_HOST, RELAY_PORT)
                else:
                    relay_server = smtplib.SMTP(RELAY_HOST, RELAY_PORT)
                    if RELAY_USE_TLS:
                        relay_server.starttls()
                
                if RELAY_USER and RELAY_PASSWORD:
                    relay_server.login(RELAY_USER, RELAY_PASSWORD)
                
                # Conversion du contenu binaire en objet message pour smtplib
                from email import message_from_bytes
                msg_obj = message_from_bytes(envelope.content)
                relay_server.send_message(msg_obj)
                relay_server.quit()
                print(f"[MAIL SERVER] ✅ Relais réussi vers {envelope.rcpt_tos}")
                return '250 Message accepted and relayed'
            except Exception as e:
                print(f"[MAIL SERVER] ❌ Échec du relais: {e}")
                # On accepte quand même le mail au niveau local même si le relais échoue
        
        return '250 Message accepted for delivery'

def run_smtp_server():
    """Lance un serveur SMTP léger sur le port 1025"""
    handler = KRONOSMailHandler()
    try:
        controller = Controller(handler, hostname='127.0.0.1', port=1025)
        controller.start()
        print("[MAIL SERVER] Serveur SMTP KRONOS démarré sur le port 1025.")
    except OSError as e:
        # Port déjà utilisé ou collision de démarrage en mode debug/reloader
        print(f"[MAIL SERVER] ⚠️  SMTP non démarré: {e}")
        return

_smtp_started = False
def start_smtp_once():
    global _smtp_started
    if _smtp_started:
        return
    _smtp_started = True
    t = threading.Thread(target=run_smtp_server, daemon=True)
    t.start()

# ============================================
# ABSTRACTION DU MAILER (SMTP PRIVÉ)
# ============================================
class PrivateMailer:
    """Classe capable de se connecter à un hôte SMTP privé via smtplib"""
    
    @staticmethod
    def send(recipient, subject, body_html):
        """Envoie un mail HTML via SMTP avec STARTTLS/SSL"""
        msg = MIMEMultipart()
        msg['From'] = SMTP_FROM
        msg['To'] = recipient
        msg['Subject'] = subject
        
        msg.attach(MIMEText(body_html, 'html'))
        
        try:
            # Connexion sécurisée
            if SMTP_PORT == 465:
                server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT)
            else:
                server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
                if SMTP_USE_TLS:
                    server.starttls()
            
            # Authentification
            if SMTP_USER and SMTP_PASSWORD:
                server.login(SMTP_USER, SMTP_PASSWORD)
            
            # Envoi
            server.send_message(msg)
            server.quit()
            return True, None
        except Exception as e:
            return False, str(e)

def send_async_email(app, msg):
    """Utilise maintenant la queue pour l'envoi asynchrone"""
    with app.app_context():
        queue_email(msg.recipients[0], msg.subject, msg.html)

# ============================================
# FONCTIONS UTILITAIRES SOCKET.IO
# ============================================
def safe_disconnect(socket_id):
    """Déconnecte proprement un utilisateur via Socket.IO"""
    try:
        # Utiliser la méthode correcte pour déconnecter un client spécifique
        # socketio.disconnect() ne fonctionne que dans le contexte d'une requête WebSocket
        # Pour déconnecter un client spécifique par son SID, utiliser server.disconnect()
        socketio.server.disconnect(socket_id)
    except AttributeError:
        # Si server.disconnect n'est pas disponible, émettre un événement de déconnexion
        try:
            socketio.emit('force_disconnect', {}, room=socket_id)
        except:
            pass
    except Exception as e:
        print(f"[KRONOS] Erreur lors de la déconnexion: {e}")

import re
import difflib
_ANTISPAM_COUNTERS = {}
_ANTISPAM_RECENT = {}
_ANTISPAM_MUTES = {}
_ANTISPAM_DUP_SERIES = {}
_ANTISPAM_DELETE_QUEUE = deque()
_ANTISPAM_WORKER_STARTED = False

_GAME_SESSIONS = {}
_GAME_SESSIONS_LOCK = threading.Lock()
_GAME_SID_INDEX = {}

EMAIL_QUEUE_ENABLED = False
DB_AUTO_MIGRATION_ENABLED = False

BATTLESHIP_DIST_DIR = Path(__file__).with_name('game') / 'battleship-main' / 'battleship-main' / 'dist'

def _start_delete_worker():
    global _ANTISPAM_WORKER_STARTED
    if _ANTISPAM_WORKER_STARTED:
        return
    _ANTISPAM_WORKER_STARTED = True
    def worker():
        while True:
            try:
                if _ANTISPAM_DELETE_QUEUE:
                    msg_id, channel_id = _ANTISPAM_DELETE_QUEUE.popleft()
                    socketio.emit('message_deleted', {'message_id': msg_id}, room=str(channel_id))
                    time.sleep(0.05)
                else:
                    time.sleep(0.2)
            except Exception as e:
                print(f"[ANTISPAM] Worker error: {e}")
                time.sleep(0.5)
    threading.Thread(target=worker, daemon=True).start()

def _generate_game_code():
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    while True:
        code = "".join(random.choice(chars) for _ in range(6))
        with _GAME_SESSIONS_LOCK:
            if code not in _GAME_SESSIONS:
                return code

def _serialize_game_session(session, current_user_id=None):
    players = []
    for uid, pdata in session.get('players', {}).items():
        if not pdata.get('is_human'):
            continue
        players.append({
            'user_id': uid,
            'username': pdata.get('username'),
            'role': pdata.get('role'),
            'ready': bool(pdata.get('ready')),
            'is_self': uid == current_user_id
        })
    can_start = False
    if current_user_id is not None:
        creator_id = session.get('creator_id')
        status = session.get('status')
        if status == 'waiting' and creator_id == current_user_id:
            human_players = [p for p in session.get('players', {}).values() if p.get('is_human')]
            if human_players and all(bool(p.get('ready')) for p in human_players):
                can_start = True
    spectators = []
    for sid, sdata in session.get('spectators', {}).items():
        spectators.append({
            'sid': sid,
            'user_id': sdata.get('user_id'),
            'username': sdata.get('username')
        })
    return {
        'code': session.get('code'),
        'game_name': session.get('game_name'),
        'mode': session.get('mode'),
        'status': session.get('status'),
        'is_private': bool(session.get('is_private')),
        'max_players': session.get('max_players', 2),
        'creator_id': session.get('creator_id'),
        'creator_username': session.get('creator_username'),
        'invited_username': session.get('invited_username'),
        'players': players,
        'spectators': spectators,
        'created_at': session.get('created_at').isoformat() if session.get('created_at') else None,
        'can_start': can_start
    }

def _game_cleanup_for_sid(sid):
    with _GAME_SESSIONS_LOCK:
        entry = _GAME_SID_INDEX.pop(sid, None)
        if not entry:
            return
        codes = list(entry.get('codes', []))
        for code in codes:
            session = _GAME_SESSIONS.get(code)
            if not session:
                continue
            for uid, pdata in list(session.get('players', {}).items()):
                sids = pdata.get('connected_sids')
                if isinstance(sids, set) and sid in sids:
                    sids.discard(sid)
            spectators = session.get('spectators', {})
            if sid in spectators:
                spectators.pop(sid, None)
            any_human = False
            human_count = 0
            for uid, pdata in session.get('players', {}).items():
                if not pdata.get('is_human'):
                    continue
                sids = pdata.get('connected_sids') or set()
                if sids:
                    any_human = True
                    human_count += 1
                    break
            if not any_human:
                if session.get('status') == 'in_progress':
                    players = session.setdefault('players', {})
                    players['_bot'] = {
                        'username': 'Ordinateur',
                        'role': 'bot',
                        'ready': True,
                        'connected_sids': set(),
                        'is_human': False,
                    }
                    any_human = True
                else:
                    _GAME_SESSIONS.pop(code, None)
                    try:
                        socketio.emit('game_closed', {
                            'code': code,
                            'reason': 'no_players'
                        }, room=f'game_{code}')
                    except Exception:
                        pass
            else:
                if session.get('status') == 'in_progress' and human_count == 1:
                    try:
                        socketio.emit('bship_opponent_left', {'code': code}, room=f'game_{code}')
                    except Exception:
                        pass
def _check_antispam(user_id, content):
    if not ANTISPAM_ENABLED:
        return None
    now = time.time()
    mute_until = _ANTISPAM_MUTES.get(user_id, 0)
    if mute_until and now < mute_until:
        return "mute_actif"
    q = _ANTISPAM_COUNTERS.get(user_id)
    if q is None:
        q = deque()
        _ANTISPAM_COUNTERS[user_id] = q
    q.append(now)
    window_start = now - ANTISPAM_RATE_WINDOW
    while q and q[0] < window_start:
        q.popleft()
    per_cutoff = now - ANTISPAM_PERSEC_WINDOW
    per_count = sum(1 for t in q if t >= per_cutoff)
    if per_count >= ANTISPAM_PERSEC_COUNT:
        _ANTISPAM_MUTES[user_id] = now + ANTISPAM_MUTE_SECONDS
        return "spam_persec"
    burst_cutoff = now - ANTISPAM_BURST_WINDOW
    burst_count = sum(1 for t in q if t >= burst_cutoff)
    if burst_count >= ANTISPAM_BURST_COUNT:
        _ANTISPAM_MUTES[user_id] = now + ANTISPAM_MUTE_SECONDS
        return "spam_burst"
    sustained_cutoff = now - ANTISPAM_SUSTAINED_WINDOW
    sustained_count = sum(1 for t in q if t >= sustained_cutoff)
    if sustained_count >= ANTISPAM_SUSTAINED_COUNT:
        _ANTISPAM_MUTES[user_id] = now + ANTISPAM_MUTE_SECONDS
        return "spam_soutenu"
    prev = _ANTISPAM_RECENT.get(user_id)
    if prev and prev.get('content') == content and now - prev.get('ts', 0) < ANTISPAM_DUPLICATE_WINDOW:
        ds = _ANTISPAM_DUP_SERIES.get(user_id, {'count': 1, 'start': now})
        ds['count'] = ds.get('count', 1) + 1
        if now - ds.get('start', now) > ANTISPAM_DUP_SERIES_WINDOW:
            ds = {'count': 1, 'start': now}
        _ANTISPAM_DUP_SERIES[user_id] = ds
        if ds['count'] >= ANTISPAM_DUP_SERIES_COUNT:
            _ANTISPAM_MUTES[user_id] = now + ANTISPAM_MUTE_SECONDS
            return "spam_duplicatif"
        return "message_duplicatif"
    _ANTISPAM_RECENT[user_id] = {'content': content, 'ts': now}
    links = re.findall(r'(https?://|www\\.)', content)
    if len(links) > ANTISPAM_MAX_LINKS:
        _ANTISPAM_MUTES[user_id] = now + ANTISPAM_MUTE_SECONDS
        return "spam_liens"
    if ANTISPAM_REPEAT_CHAR_MIN > 1 and content:
        if re.search(r'(.)\\1{' + str(ANTISPAM_REPEAT_CHAR_MIN) + r',}', content):
            _ANTISPAM_MUTES[user_id] = now + ANTISPAM_MUTE_SECONDS
            return "spam_chars"
    mentions = re.findall(r'@\\w+', content)
    if len(mentions) > ANTISPAM_MAX_MENTIONS:
        return "trop_de_mentions"
    return None

def _delete_recent_messages_of_user(user_id, seconds_window):
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=seconds_window)
        msgs = Message.query.filter(
            Message.user_id == user_id,
            Message.is_deleted == False,
            Message.created_at >= cutoff
        ).all()
        for m in msgs:
            m.is_deleted = True
            m.content = ""
        db.session.commit()
        for m in msgs:
            _ANTISPAM_DELETE_QUEUE.append((m.id, m.channel_id))
        _start_delete_worker()
        if msgs:
            print(f"[ANTISPAM] Suppressions en file: {len(msgs)} messages récents pour user {user_id}")
    except Exception as e:
        print(f"[ANTISPAM] Erreur suppression messages: {e}")

# ============================================
# SYSTÈME DE VALIDATION DES PSEUDONYMES
# ============================================
class NicknameValidator:
    OFFENSIVE_TERMS = ["inapproprié", "vulgaire", "insulte"] # Liste simplifiée pour l'exemple
    FORBIDDEN_EMOJIS = ["🍑", "🍆"]
    MARTIN_VARIANTS_REGEX = r"(?i)m[a@4]rt[i1l]n"
    
    @staticmethod
    def validate(username):
        """Valide un pseudonyme selon les règles de sécurité et de contenu"""
        if not username or len(username) < 3:
            return False, "Le pseudonyme doit contenir au moins 3 caractères."
        
        # 1. Détection des emojis interdits
        for emoji in NicknameValidator.FORBIDDEN_EMOJIS:
            if emoji in username:
                return False, f"L'emoji {emoji} est strictement interdit dans les pseudonymes."
        
        # 2. Détection de "Martin" et ses variantes (Regex)
        if re.search(NicknameValidator.MARTIN_VARIANTS_REGEX, username):
            return False, "Ce pseudonyme n'est pas autorisé par la politique de sécurité."
        
        # 3. Détection par similarité (Martin)
        username_clean = re.sub(r'[^a-zA-Z]', '', username).lower()
        similarity = difflib.SequenceMatcher(None, username_clean, "martin").ratio()
        if similarity > 0.8:
            return False, "Ce pseudonyme est trop similaire à un terme interdit."
        
        # 4. Détection de termes offensants
        for term in NicknameValidator.OFFENSIVE_TERMS:
            if term in username.lower():
                return False, "Le pseudonyme contient un terme inapproprié."
        
        return True, None

    @staticmethod
    def generate_suggestions(base_name):
        """Génère des variantes créatives pour un pseudonyme déjà utilisé"""
        suggestions = []
        clean_name = re.sub(r'[^a-zA-Z0-9]', '', base_name)
        
        # Variantes numériques
        suggestions.append(f"{clean_name}1")
        suggestions.append(f"{clean_name}{datetime.now().year}")
        
        # Modifications subtiles
        suggestions.append(f"{clean_name}_")
        suggestions.append(f"Le{clean_name}")
        
        # Suffixes créatifs
        suggestions.append(f"{clean_name}Officiel")
        suggestions.append(f"Real{clean_name}")
        
        # Vérifier que les suggestions sont elles-mêmes valides et disponibles
        valid_suggestions = []
        for s in suggestions:
            is_valid, _ = NicknameValidator.validate(s)
            if is_valid:
                # Vérifier si le nom est utilisé comme username OU display_name
                exists = User.query.filter((User.username == s) | (User.display_name == s)).first()
                if not exists:
                    valid_suggestions.append(s)
        
        return valid_suggestions[:4]

# ============================================
# INITIALISATION APPLICATION
# ============================================
app = Flask(__name__, template_folder='templates', static_folder='static')
app.config.from_object('config')
app.config.setdefault('UPLOAD_FOLDER', str(UPLOADS_DIR))

# Debug Toolbar (activée seulement en DEBUG)
try:
    from flask_debugtoolbar import DebugToolbarExtension
    if DEBUG:
        app.config['DEBUG_TB_INTERCEPT_REDIRECTS'] = False
        app.config['DEBUG_TB_PROFILER_ENABLED'] = False
        app.config['DEBUG_TB_TEMPLATE_EDITOR_ENABLED'] = False
        toolbar = DebugToolbarExtension(app)
except Exception:
    pass

# Démarrage conditionnel des services en arrière-plan (évite double lancement avec le reloader)
if (os.environ.get('WERKZEUG_RUN_MAIN') == 'true') or (not DEBUG):
    try:
        start_smtp_once()
    except Exception as e:
        print(f"[INIT] SMTP non démarré: {e}")

# ============================================
# SYSTÈME D'INTERNATIONALISATION (i18n)
# ============================================
TRANSLATIONS = {
    'fr': {
        'members': 'Membres',
        'files': 'Fichiers',
        'logs': 'Logs',
        'settings': 'Paramètres',
        'credits': 'Crédits',
        'logout': 'Déconnexion',
        'login': 'Connexion',
        'register': 'S\'inscrire',
        'search': 'Rechercher...',
        'no_account': "Vous n'avez pas de compte",
        'admin_bulk_delete': 'Suppression massive admin',
        'profile': 'Profil',
        'upload': 'Télécharger',
        'save': 'Enregistrer',
        'cancel': 'Annuler',
        'uploader': 'Publieur',
        'date': 'Date',
        'type': 'Type',
        'size': 'Taille',
        'actions': 'Actions',
        'confirm_delete': 'Confirmer la suppression',
    },
    'en': {
        'members': 'Members',
        'files': 'Files',
        'logs': 'Logs',
        'settings': 'Settings',
        'credits': 'Credits',
        'logout': 'Logout',
        'login': 'Login',
        'register': 'Register',
        'search': 'Search...',
        'no_account': "You don't have an account",
        'admin_bulk_delete': 'Admin bulk delete',
        'profile': 'Profile',
        'upload': 'Upload',
        'save': 'Save',
        'cancel': 'Cancel',
        'uploader': 'Uploader',
        'date': 'Date',
        'type': 'Type',
        'size': 'Size',
        'actions': 'Actions',
        'confirm_delete': 'Confirm deletion',
    }
}

@app.context_processor
def utility_processor():
    def gettext(key):
        lang = request.cookies.get('lang', 'fr')
        return TRANSLATIONS.get(lang, TRANSLATIONS['fr']).get(key, key)
    return dict(_=gettext)

@app.route('/set-lang/<lang>')
def set_lang(lang):
    if lang in TRANSLATIONS:
        resp = make_response(redirect(request.referrer or '/'))
        resp.set_cookie('lang', lang, max_age=30*24*60*60)
        return resp
    return redirect(request.referrer or '/')

# Migration automatique de la base de données pour les colonnes manquantes
def migrate_database():
    import sqlite3
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Table users
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'reset_token' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN reset_token TEXT')
            print("[DB] Colonne reset_token ajoutée.")
            
        if 'reset_token_expires_at' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN reset_token_expires_at DATETIME')
            print("[DB] Colonne reset_token_expires_at ajoutée.")
        
        if 'mute_until' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN mute_until DATETIME')
            print("[DB] Colonne mute_until ajoutée.")

        if 'theme' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN theme TEXT DEFAULT "dark"')
            print("[DB] Colonne theme ajoutée.")
            
        if 'notif_sound' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN notif_sound BOOLEAN DEFAULT 1')
            print("[DB] Colonne notif_sound ajoutée.")
            
        if 'animations_enabled' not in columns:
            cursor.execute('ALTER TABLE users ADD COLUMN animations_enabled BOOLEAN DEFAULT 1')
            print("[DB] Colonne animations_enabled ajoutée.")
            
        # Table email_messages
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_messages (
                id TEXT PRIMARY KEY,
                recipient TEXT NOT NULL,
                subject TEXT NOT NULL,
                body_html TEXT NOT NULL,
                status TEXT DEFAULT 'pending' NOT NULL,
                attempts INTEGER DEFAULT 0 NOT NULL,
                max_retries INTEGER DEFAULT 3 NOT NULL,
                last_attempt DATETIME,
                error_log TEXT,
                sent_at DATETIME,
                is_opened BOOLEAN DEFAULT 0 NOT NULL,
                opened_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_recipient ON email_messages(recipient)")
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] Échec de la migration automatique : {e}")

# ============================================
# SYSTÈME DE FILE D'ATTENTE D'EMAILS
# ============================================
def email_worker():
    if not EMAIL_QUEUE_ENABLED:
        return
    with app.app_context():
        print("[MAIL] Worker de file d'attente démarré.")
        Session = sessionmaker(bind=db.engine)
        while True:
            session = None
            try:
                session = Session()
                pending_emails = session.query(EmailMessage).filter(
                    EmailMessage.status.in_([EmailStatus.PENDING, EmailStatus.RETRYING])
                ).all()
                for email_msg in pending_emails:
                    try:
                        email_msg.status = EmailStatus.SENDING
                        email_msg.attempts += 1
                        email_msg.last_attempt = datetime.now(timezone.utc)
                        session.commit()
                        server_url = f"http://{SERVER_IP_ADDRESS}:5000/" if 'SERVER_IP_ADDRESS' in globals() and SERVER_IP_ADDRESS else "http://localhost:5000/"
                        tracking_pixel = f'<img src="{server_url}api/mail/track/{email_msg.id}" width="1" height="1" style="display:none">'
                        success, error = PrivateMailer.send(
                            recipient=email_msg.recipient,
                            subject=email_msg.subject,
                            body_html=email_msg.body_html + tracking_pixel
                        )
                        if success:
                            email_msg.status = EmailStatus.SENT
                            email_msg.sent_at = datetime.now(timezone.utc)
                            email_msg.error_log = None
                            session.commit()
                            print(f"[MAIL] Email envoyé à {email_msg.recipient}")
                        else:
                            raise Exception(error)
                    except Exception as e:
                        session.rollback()
                        error_msg = str(e)
                        email_msg.error_log = error_msg
                        if email_msg.attempts < email_msg.max_retries:
                            email_msg.status = EmailStatus.RETRYING
                        else:
                            email_msg.status = EmailStatus.FAILED
                        session.commit()
                        print(f"[MAIL ERROR] Échec envoi à {email_msg.recipient}: {error_msg}")
            except OperationalError as e:
                print(f"[MAIL WORKER DB ERROR] {e}")
                time.sleep(5)
            except Exception as e:
                print(f"[MAIL WORKER ERROR] {e}")
            finally:
                if session is not None:
                    try:
                        session.close()
                    except Exception:
                        pass
            time.sleep(10)

def queue_email(recipient, subject, body_html):
    if not EMAIL_QUEUE_ENABLED:
        print("[MAIL] Système d'email désactivé")
        return False
    try:
        email_msg = EmailMessage(
            recipient=recipient,
            subject=subject,
            body_html=body_html
        )
        db.session.add(email_msg)
        db.session.commit()
        return True
    except Exception as e:
        print(f"[MAIL ERROR] Échec mise en file d'attente: {e}")
        return False

# Remplacer send_async_email par une version qui utilise la queue
def send_async_email(app, msg):
    """Ancienne fonction conservée pour compatibilité mais utilisant maintenant la queue"""
    with app.app_context():
        queue_email(msg.recipients[0], msg.subject, msg.html)
# Exécuter la migration au démarrage (Compatible Flask 3.x)
def ensure_db_file_ok():
    engine = db.engine
    if engine.dialect.name != 'sqlite':
        return
    db_path = Path(str(DB_PATH))
    if not db_path.exists():
        return
    import sqlite3
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute('PRAGMA integrity_check;')
    res = cur.fetchone()
    conn.close()
    if not res or (isinstance(res, tuple) and res[0] != 'ok') or (isinstance(res, str) and res != 'ok'):
        raise Exception('integrity check failed')
def verify_db_structure():
    try:
        from models import (
            User,
            Channel,
            ChannelParticipant,
            Message,
            MessagePin,
            MessageReaction,
            FileAttachment,
            BannedIP,
            AuditLog,
            Contributor,
            MessageRead,
            OnlinePresence,
            EmailMessage,
            GameSession,
        )
    except Exception:
        User = Channel = ChannelParticipant = Message = MessagePin = None
        MessageReaction = FileAttachment = BannedIP = AuditLog = None
        Contributor = MessageRead = OnlinePresence = EmailMessage = GameSession = None
    engine = db.engine
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    # Créer les tables manquantes de manière non destructive
    for model in [
        User,
        Channel,
        ChannelParticipant,
        Message,
        MessagePin,
        MessageReaction,
        FileAttachment,
        BannedIP,
        AuditLog,
        Contributor,
        MessageRead,
        OnlinePresence,
        EmailMessage,
        GameSession,
    ]:
        if model is None:
            continue
        name = getattr(model, '__tablename__', None)
        if not name or name in tables:
            continue
        model.__table__.create(bind=engine, checkfirst=True)
        tables.add(name)
    if engine.dialect.name == 'sqlite':
        with engine.begin() as conn:
            def ensure_sqlite_columns(table_name, columns_spec, create_index_stmt=None):
                if table_name not in tables:
                    return
                existing_cols = {col['name'] for col in inspector.get_columns(table_name)}
                for name, type_sql, default_sql in columns_spec:
                    if name in existing_cols:
                        continue
                    ddl = f'ALTER TABLE {table_name} ADD COLUMN {name} {type_sql}'
                    if default_sql is not None:
                        ddl += f' DEFAULT {default_sql}'
                    conn.execute(text(ddl))
                    existing_cols.add(name)
            ensure_sqlite_columns(
                'users',
                [
                    ('reset_token', 'TEXT', None),
                    ('reset_token_expires_at', 'DATETIME', None),
                    ('mute_until', 'DATETIME', None),
                    ('last_ip', 'TEXT', None),
                    ('theme', 'TEXT', "'dark'"),
                    ('notif_sound', 'BOOLEAN', '1'),
                    ('animations_enabled', 'BOOLEAN', '1'),
                    ('personal_panic_url', 'VARCHAR(500)', None),
                    ('personal_panic_hotkey', 'VARCHAR(50)', None),
                ]
            )
            ensure_sqlite_columns(
                'email_messages',
                [
                    ('status', 'TEXT', "'pending'"),
                    ('attempts', 'INTEGER', '0'),
                    ('max_retries', 'INTEGER', '3'),
                    ('last_attempt', 'DATETIME', None),
                    ('error_log', 'TEXT', None),
                    ('sent_at', 'DATETIME', None),
                    ('is_opened', 'BOOLEAN', '0'),
                    ('opened_at', 'DATETIME', None),
                    ('created_at', 'DATETIME', None),
                ]
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_email_recipient ON email_messages(recipient)"))
            ensure_sqlite_columns(
                'game_sessions',
                [
                    ('name', 'TEXT', "'Battleship'"),
                    ('game_type', 'VARCHAR(50)', "'battleship'"),
                    ('is_private', 'BOOLEAN', '0'),
                    ('join_code', 'VARCHAR(20)', None),
                    ('created_by_id', 'TEXT', None),
                    ('max_players', 'INTEGER', '2'),
                    ('players_json', 'TEXT', "'[]'"),
                    ('state_json', 'TEXT', "'{}'"),
                    ('current_turn_user_id', 'TEXT', None),
                    ('code', 'VARCHAR(12)', None),
                    ('status', 'TEXT', "'waiting'"),
                    ('mode', 'TEXT', "'pvp'"),
                    ('p1_id', 'TEXT', None),
                    ('p2_id', 'TEXT', None),
                    ('p1_ready', 'BOOLEAN', '0'),
                    ('p2_ready', 'BOOLEAN', '0'),
                    ('current_turn', 'TEXT', None),
                    ('p1_board', 'TEXT', None),
                    ('p2_board', 'TEXT', None),
                    ('history', 'TEXT', None),
                    ('spectators', 'TEXT', None),
                    ('created_at', 'DATETIME', None),
                    ('updated_at', 'DATETIME', None),
                ]
            )

def backup_database():
    try:
        db_path = DB_PATH
        if not db_path:
            return
        db_path = Path(str(db_path))
        if not db_path.exists():
            return
        backup_dir = db_path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_path = backup_dir / f"kronos_startup_{ts}.db"
        shutil.copy2(str(db_path), str(backup_path))
        backups = sorted(backup_dir.glob("kronos_startup_*.db"))
        if len(backups) > 5:
            for old in backups[:-5]:
                try:
                    old.unlink()
                except Exception:
                    pass
    except Exception as e:
        print(f"[DB BACKUP ERROR] {e}")

def restore_last_backup():
    try:
        db_path = DB_PATH
        if not db_path:
            return False
        db_path = Path(str(db_path))
        backup_dir = db_path.parent / "backups"
        if not backup_dir.exists():
            return False
        backups = sorted(backup_dir.glob("kronos_startup_*.db"))
        if not backups:
            return False
        last = backups[-1]
        shutil.copy2(str(last), str(db_path))
        return True
    except Exception as e:
        print(f"[DB RESTORE ERROR] {e}")
        return False

# Vérification de la configuration SMTP au démarrage
def check_smtp_config():
    missing = []
    if not SMTP_HOST: missing.append('SMTP_HOST')
    if not SMTP_USER: missing.append('SMTP_USER')
    
    if missing:
        print("\n" + "!"*60)
        print(" ATTENTION : CONFIGURATION SMTP PRIVÉE INCOMPLÈTE")
        print(f" Variables manquantes : {', '.join(missing)}")
        print(" L'envoi d'emails échouera tant que ces valeurs ne sont pas")
        print(" configurées dans config.py.")
        print("!"*60 + "\n")
    else:
        print(f"[MAIL] Configuration SMTP Privée détectée pour : {SMTP_USER}")

check_smtp_config()

for root, dirs, files in os.walk(app.static_folder):
    for f in files: os.utime(os.path.join(root, f), (time.time(), time.time()))

# Extensions
db.init_app(app)
mail.init_app(app)
CORS(app, resources={r"/*": {"origins": "*"}})

# Login Manager
login_manager.init_app(app)
login_manager.login_view = 'login'

# Handler personnalisé pour les requêtes non autorisées (retourne JSON au lieu de redirect)
@login_manager.unauthorized_handler
def unauthorized():
    from flask import jsonify
    return jsonify({'error': 'Authentification requise', 'authenticated': False}), 401

# Importer les modèles APRÈS l'initialisation de db
from models import *

# Autoriser le skip de la vérification DB via variable d'environnement (utile pour tests)
if not os.environ.get('KRONOS_SKIP_DB_VERIFY'):
    with app.app_context():
        try:
            backup_database()
        except Exception as e:
            print(f"[DB BACKUP ERROR] {e}")
        ensure_db_file_ok()
        engine = db.engine
        try:
            db_path = None
            is_sqlite = engine.dialect.name == 'sqlite'
            if is_sqlite:
                db_path = Path(str(DB_PATH))
            if is_sqlite and (not db_path or not db_path.exists()):
                raise RuntimeError(f"Base SQLite introuvable à {DB_PATH}. Restaure ou copie ton fichier existant, aucune recréation automatique n'est faite.")
            # Réparation non destructive systématique :
            # - création des tables manquantes
            # - ajout des colonnes manquantes
            verify_db_structure()
            print("Vérification DB non destructive OK (tables manquantes / colonnes ajoutées).")
        except Exception as e:
            print(f"[DB VERIFY ERROR] {e}")
            restored = restore_last_backup()
            if restored:
                print("[DB] Base restaurée automatiquement depuis le dernier backup de démarrage.")
            raise

socketio = SocketIO(app, async_mode=SOCKETIO_ASYNC_MODE, cors_allowed_origins="*", ping_timeout=10, ping_interval=5)

if EMAIL_QUEUE_ENABLED:
    email_thread = threading.Thread(target=email_worker, daemon=True)
    email_thread.start()

# ============================================
# FONCTIONS UTILITAIRES
# ============================================
def broadcast_channel_activity(channel_id):
    try:
        socketio.emit('channel_activity', {'channel_id': str(channel_id)}, broadcast=True)
    except Exception as e:
        print(f"[SocketIO] channel_activity emit error: {e}")
def get_client_ip():
    """Récupère l'IP du client, utile pour l'Admin Suprême"""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr

def is_ip_banned(ip):
    """Vérifie si une IP est bannie"""
    banned = BannedIP.query.filter_by(ip_address=ip).first()
    if banned and banned.expires_at:
        if datetime.now(timezone.utc) > banned.expires_at:
            db.session.delete(banned)
            db.session.commit()
            return False
    return banned is not None

def is_supreme_admin(user=None, ip=None):
    """
    Détermine si l'utilisateur est Admin Suprême
    L'IP qui lance le serveur ou ADMIN_SUPREME_IP devient Admin Suprême
    """
    target_ip = ip or get_client_ip()
    
    # Vérifier si l'IP est celle de l'admin supreme
    if ADMIN_SUPREME_IP and target_ip == ADMIN_SUPREME_IP:
        return True
    
    # Si lancé en local (127.0.0.1 ou localhost)
    if target_ip in ['127.0.0.1', 'localhost', '::1']:
        return True
    
    # Vérifier le flag de session pour les connexions WebSocket
    if user and hasattr(user, 'is_authenticated') and user.is_authenticated:
        return user.is_supreme
    
    return False

def admin_required(f):
    """Décorateur pour les routes nécessitant des droits admin"""
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentification requise'}), 401
        
        if not current_user.is_admin:
            return jsonify({'error': 'Droits administrateur requis'}), 403
        
        return f(*args, **kwargs)
    return decorated_function

def supreme_only(f):
    """Décorateur pour les routes nécessitant l'Admin Suprême"""
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentification requise'}), 401
        
        if not current_user.is_supreme:
            return jsonify({'error': 'Action réservée à l\'Admin Suprême'}), 403
        
        return f(*args, **kwargs)
    return decorated_function

def allowed_file(filename):
    """Vérifie si le fichier est autorisé"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_file_type(filename):
    """Détermine le type de fichier"""
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    
    images = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
    videos = {'mp4', 'webm', 'mkv', 'avi'}
    audio = {'mp3', 'wav', 'ogg', 'flac'}
    documents = {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'}
    
    if ext in images:
        return 'image'
    elif ext in videos:
        return 'video'
    elif ext in audio:
        return 'audio'
    elif ext in documents:
        return 'document'
    else:
        return 'file'

def log_action(actor, action_type, target_id=None, target_type=None, details=None):
    """Enregistre une action dans le journal d'audit"""
    log = AuditLog(
        actor_id=actor.id if actor else None,
        action_type=action_type,
        target_id=target_id,
        target_type=target_type,
        details=details,
        ip_address=get_client_ip()
    )
    db.session.add(log)
    db.session.commit()

def update_all_usernames(old_username, new_username):
    """Met à jour le pseudo dans tous les messages (approche avec display_name dynamique)"""
    # Note: Nous stockons le display_name au moment de l'envoi du message
    # Cette fonction n'est plus nécessaire car on utilise la relation
    pass

# ============================================
# GESTION UTILISATEURS
# ============================================
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, user_id)

@app.route('/api/auth/check-nickname', methods=['POST'])
def check_nickname():
    """Vérifie la validité et la disponibilité d'un pseudonyme en temps réel"""
    data = request.get_json()
    username = data.get('username', '').strip()
    
    # 1. Validation du contenu
    is_valid, error_msg = NicknameValidator.validate(username)
    if not is_valid:
        # Log de la tentative rejetée
        print(f"[SECURITY] Pseudonyme rejeté (Contenu): {username} - Raison: {error_msg}")
        return jsonify({
            'available': False,
            'valid': False,
            'error': error_msg
        }), 200 # Retourne 200 pour une vérification normale
        
    # 2. Vérification des doublons (Username OU Display Name)
    existing_user = User.query.filter((User.username == username) | (User.display_name == username)).first()
    if existing_user:
        # Si c'est l'utilisateur actuel qui vérifie son propre nom, c'est OK
        if hasattr(current_user, 'id') and existing_user.id == current_user.id:
            return jsonify({
                'available': True,
                'valid': True,
                'message': 'C\'est votre pseudonyme actuel'
            }), 200
            
        suggestions = NicknameValidator.generate_suggestions(username)
        return jsonify({
            'available': False,
            'valid': True,
            'error': 'Ce pseudonyme est déjà utilisé par un autre membre.',
            'suggestions': suggestions
        }), 200
        
    return jsonify({
        'available': True,
        'valid': True,
        'message': 'Pseudonyme disponible'
    }), 200

@app.route('/api/auth/register', methods=['POST'])
def register():
    """Inscription d'un nouvel utilisateur"""
    data = request.get_json()
    
    # Vérification IP bannie
    if is_ip_banned(get_client_ip()):
        return jsonify({'error': 'Accès refusé'}), 403
    
    # Validation
    if not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Tous les champs sont requis'}), 400
    
    # Validation du pseudonyme (NicknameValidator)
    is_valid, error_msg = NicknameValidator.validate(data['username'])
    if not is_valid:
        return jsonify({'error': error_msg}), 400
    
    # Vérifier si le nom est utilisé comme username OU display_name
    if User.query.filter((User.username == data['username']) | (User.display_name == data['username'])).first():
        return jsonify({'error': 'Ce pseudonyme est déjà utilisé par un autre membre'}), 400
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Cette adresse email est déjà utilisée'}), 400
    
    if len(data['password']) < 8:
        return jsonify({'error': 'Le mot de passe doit contenir au moins 8 caractères'}), 400
    
    # Création de l'utilisateur
    user = User(
        username=data['username'],
        email=data['email'],
        display_name=data.get('display_name') or data['username']
    )
    user.set_password(data['password'])
    
    # Vérifier si c'est l'admin supreme (premier utilisateur)
    if User.query.count() == 0:
        user.role = UserRole.SUPREME
    
    db.session.add(user)
    db.session.commit()
    
    log_action(user, ActionType.PROMOTE, target_id=user.id, 
               target_type='user', details=f'Inscription avec rôle: {user.role}')
    
    # Connecter automatiquement l'utilisateur après inscription
    login_user(user, remember=data.get('remember', False))
    
    # Émettre un message système dans le salon général pour annoncer la rejoint
    try:
        general_channel = Channel.query.filter_by(name='général').first()
        if general_channel:
            system_message = Message(
                channel_id=general_channel.id,
                user_id=user.id,
                content=f"{user.display_name} a rejoint le serveur",
                message_type='system'
            )
            db.session.add(system_message)
            db.session.commit()
            # CORRECTION : Utiliser str() pour la room
            socketio.emit('new_message', system_message.to_dict(), room=str(general_channel.id))
            broadcast_channel_activity(general_channel.id)
    except Exception as e:
        # Ne pas bloquer l'inscription si le message système échoue
        print(f"[Warning] Impossible d'émettre le message de bienvenue: {e}")
    
    return jsonify({'message': 'Compte créé avec succès', 'user': user.to_dict()}), 201

# ============================================
# RÉCUPÉRATION DE COMPTE
# ============================================
@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    return jsonify({'error': 'Récupération de compte désactivée'}), 403

@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    return jsonify({'error': 'Réinitialisation de mot de passe désactivée'}), 403

@app.route('/reset-password')
def reset_password_page():
    return redirect(url_for('login_page'))

# ============================================
# MONITORING EMAILS (ADMIN)
# ============================================
@app.route('/api/mail/track/<message_id>')
def track_email_open(message_id):
    """Pixel de tracking pour les ouvertures d'emails"""
    email_msg = EmailMessage.query.get(message_id)
    if email_msg and not email_msg.is_opened:
        email_msg.is_opened = True
        email_msg.opened_at = datetime.now(timezone.utc)
        db.session.commit()
        print(f"[MAIL] Ouverture détectée pour l'email {message_id} ({email_msg.recipient})")
    
    # Retourner une image GIF 1x1 transparente
    import base64
    pixel_data = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
    return pixel_data, 200, {'Content-Type': 'image/gif'}

@app.route('/api/admin/emails')
@admin_required
def get_email_stats():
    """Récupère les statistiques et logs des emails (Admin seulement)"""
    emails = EmailMessage.query.order_by(EmailMessage.created_at.desc()).limit(100).all()
    
    # Stats globales
    total = EmailMessage.query.count()
    sent = EmailMessage.query.filter_by(status=EmailStatus.SENT).count()
    failed = EmailMessage.query.filter_by(status=EmailStatus.FAILED).count()
    opened = EmailMessage.query.filter_by(is_opened=True).count()
    
    return jsonify({
        'stats': {
            'total': total,
            'sent': sent,
            'failed': failed,
            'opened': opened,
            'open_rate': round((opened / sent * 100), 2) if sent > 0 else 0
        },
        'emails': [e.to_dict() for e in emails]
    })

@app.route('/admin/emails')
@admin_required
def admin_emails_page():
    """Page d'administration des emails"""
    return render_template('admin_emails.html', theme=THEME)

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Connexion utilisateur"""
    data = request.get_json()
    client_ip = get_client_ip()
    
    # Vérification IP bannie
    if is_ip_banned(client_ip):
        return jsonify({'error': 'Accès refusé'}), 403
    
    user = User.query.filter_by(username=data.get('username')).first()
    
    if not user or not user.check_password(data.get('password', '')):
        return jsonify({'error': 'Nom d\'utilisateur ou mot de passe incorrect'}), 401
    
    if not user.is_active:
        return jsonify({'error': 'Ce compte a été désactivé'}), 403
    
    # Vérifier si c'est l'admin supreme par IP
    if is_supreme_admin(ip=client_ip):
        user.role = UserRole.SUPREME
        db.session.commit()
        print(f"[Auth] {user.username} promu Admin Suprême via IP: {client_ip}")
    
    # Enregistrer l'IP de connexion
    user.last_ip = client_ip
    user.last_seen = datetime.now(timezone.utc)
    db.session.commit()
    
    login_user(user, remember=data.get('remember', False))
    
    return jsonify({
        'message': 'Connexion réussie',
        'user': user.to_dict(),
        'is_supreme': user.is_supreme
    })

@app.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    """Déconnexion"""
    logout_user()
    return jsonify({'message': 'Déconnexion réussie'})

@app.route('/api/user/profile', methods=['GET'])
@login_required
def get_profile():
    """Récupère le profil de l'utilisateur connecté"""
    return jsonify({'user': current_user.to_dict(include_sensitive=True)})

@app.route('/api/user/profile', methods=['PUT'])
@login_required
def update_profile():
    """Met à jour le profil"""
    data = request.get_json(silent=True) or {}
    
    if 'display_name' in data:
        new_name = data['display_name'].strip()
        if new_name != current_user.display_name:
            # Valider le contenu
            is_valid, error_msg = NicknameValidator.validate(new_name)
            if not is_valid:
                return jsonify({'error': error_msg}), 400
            
            # Vérifier les doublons
            existing = User.query.filter((User.username == new_name) | (User.display_name == new_name)).first()
            if existing and existing.id != current_user.id:
                return jsonify({'error': 'Ce pseudonyme est déjà utilisé par un autre membre.'}), 400
                
            current_user.display_name = new_name
    
    if 'bio' in data:
        current_user.bio = data['bio']
    
    if 'banner_filename' in data:
        current_user.banner_filename = data['banner_filename']
    
    if 'avatar_filename' in data:
        current_user.avatar_filename = data['avatar_filename']
    
    db.session.commit()
    
    return jsonify({'message': 'Profil mis à jour', 'user': current_user.to_dict(include_sensitive=True)})

@app.route('/api/user/password', methods=['PUT'])
@login_required
def change_password():
    """Change le mot de passe"""
    data = request.get_json()
    
    if not current_user.check_password(data.get('old_password', '')):
        return jsonify({'error': 'Mot de passe actuel incorrect'}), 400
    
    if len(data.get('new_password', '')) < 8:
        return jsonify({'error': 'Le nouveau mot de passe doit contenir au moins 8 caractères'}), 400
    
    current_user.set_password(data['new_password'])
    db.session.commit()
    
    log_action(current_user, ActionType.EDIT_MESSAGE, target_id=current_user.id,
               target_type='user', details='Changement de mot de passe')
    
    return jsonify({'message': 'Mot de passe mis à jour'})

@app.route('/api/user/settings', methods=['PUT'])
@login_required
def update_user_settings():
    """Met à jour les paramètres de l'utilisateur (thème, sons, etc)"""
    data = request.get_json()
    
    if 'theme' in data:
        current_user.theme = data['theme']
    
    if 'notif_sound' in data:
        current_user.notif_sound = bool(data['notif_sound'])
        
    if 'animations_enabled' in data:
        current_user.animations_enabled = bool(data['animations_enabled'])
        
    db.session.commit()
    return jsonify({'message': 'Paramètres mis à jour'})

@app.route('/api/user/upload-profile-image', methods=['POST'])
@login_required
def upload_profile_image(user=None):
    """Téléchargement d'avatar ou de bannière"""
    app.logger.info("upload_profile_image: start")
    if 'file' not in request.files:
        app.logger.warning("upload_profile_image: no file field in request")
        return jsonify({'error': 'Aucun fichier envoyé'}), 400
    
    file = request.files['file']
    img_type = request.form.get('type', 'avatar')
    app.logger.info(f"upload_profile_image: type={img_type}, filename={file.filename}, content_type={file.content_type}")
    
    if file.filename == '':
        app.logger.warning("upload_profile_image: empty filename")
        return jsonify({'error': 'Nom de fichier vide'}), 400
        
    # Validation MIME souple: si content_type absent, on se base sur l'extension plus bas
    if file.content_type and (not file.content_type.startswith('image/')):
        app.logger.warning(f"upload_profile_image: invalid mime type {file.content_type}")
        return jsonify({'error': 'Seules les images sont autorisées'}), 400

    # Créer le dossier si nécessaire (chemins robustes)
    sub_dir = 'avatars' if img_type == 'avatar' else 'banners'
    base_uploads = os.path.abspath(str(UPLOADS_DIR))
    upload_dir = os.path.abspath(os.path.join(base_uploads, sub_dir))
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir, exist_ok=True)
    app.logger.info(f"upload_profile_image: upload_dir={upload_dir}")
    
    ext = os.path.splitext(file.filename)[1].lower().strip()
    if ext not in {'.png', '.jpg', '.jpeg', '.gif', '.webp'}:
        app.logger.warning(f"upload_profile_image: invalid extension {ext}")
        return jsonify({'error': 'Extension non autorisée pour l’image'}), 400
    
    user_obj = user or current_user
    filename = f"{user_obj.id}_{uuid.uuid4().hex}{ext}"
    file_path = os.path.abspath(os.path.join(upload_dir, filename))
    app.logger.info(f"upload_profile_image: file_path={file_path}")
    try:
        file.save(file_path)
    except Exception as e:
        import traceback
        print(f"[UPLOAD ERROR] {e}")
        print(traceback.format_exc())
        app.logger.exception("upload_profile_image: error while saving file")
        return jsonify({'error': f'Erreur lors de l’enregistrement du fichier: {e} (path={file_path})'}), 500
    
    size = os.path.getsize(file_path)
    if size > 8 * 1024 * 1024:
        os.remove(file_path)
        app.logger.warning(f"upload_profile_image: file too large ({size} bytes)")
        return jsonify({'error': 'Fichier trop volumineux (max 8MB)'}), 400
    
    app.logger.info(f"upload_profile_image: success filename={filename}, size={size}")
    return jsonify({'filename': filename})

# ============================================
# GESTION DES SALONS
# ============================================
@app.route('/api/channels', methods=['GET'])
@login_required
def get_channels():
    """Liste tous les salons accessibles selon les permissions de l'utilisateur"""
    channels = Channel.query.order_by(Channel.category, Channel.order).all()
    
    # Grouper par catégorie et filtrer selon les permissions
    categories = {}
    for channel in channels:
        # Le salon #admin est réservé aux admins
        if channel.name == 'admin' and not current_user.is_admin:
            continue
        
        
        category = channel.category or 'Sans catégorie'
        if category not in categories:
            categories[category] = []
        categories[category].append(channel.to_dict())
    
    return jsonify({
        'channels': categories,
        'user_role': current_user.role,
        'is_admin': current_user.is_admin
    })

@app.route('/api/channels/<channel_id>', methods=['GET'])
@login_required
def get_channel_info(channel_id):
    """Récupère les informations d'un salon et vérifie l'accès"""
    channel = db.session.get(Channel, channel_id)
    
    if not channel:
        return jsonify({'error': 'Salon non trouvé'}), 404
    
    # Vérifier l'accès au salon #admin
    if channel.name == 'admin' and not current_user.is_admin:
        return jsonify({'error': 'Accès refusé à ce salon'}), 403
    
    return jsonify({'channel': channel.to_dict()})

@app.route('/api/channels', methods=['POST'])
@admin_required
def create_channel():
    """Crée un nouveau salon"""
    data = request.get_json()
    
    channel = Channel(
        name=data['name'],
        description=data.get('description'),
        channel_type=data.get('type', ChannelType.PUBLIC),
        category=data.get('category')
    )
    
    db.session.add(channel)
    db.session.commit()
    
    return jsonify({'message': 'Salon créé', 'channel': channel.to_dict()}), 201

@app.route('/api/channels/<channel_id>', methods=['DELETE'])
@admin_required
def delete_channel(channel_id):
    """Supprime un salon"""
    channel = db.session.get(Channel, channel_id)
    
    if not channel:
        return jsonify({'error': 'Salon non trouvé'}), 404
    
    # Supprimer tous les messages
    Message.query.filter_by(channel_id=channel_id).delete()
    
    db.session.delete(channel)
    db.session.commit()
    
    return jsonify({'message': 'Salon supprimé'})

# ============================================
# GESTION DES JEUX / PARTIES
# ============================================
@app.route('/api/games', methods=['GET'])
@login_required
def list_games():
    visible = []
    with _GAME_SESSIONS_LOCK:
        for code, session_data in _GAME_SESSIONS.items():
            if session_data.get('is_private'):
                if session_data.get('creator_id') != current_user.id and session_data.get('invited_username') not in {current_user.username, current_user.display_name}:
                    continue
            visible.append(_serialize_game_session(session_data, current_user_id=current_user.id))
    return jsonify({'games': visible})

@app.route('/api/games', methods=['POST'])
@login_required
def create_game():
    data = request.get_json(silent=True) or {}
    game_name = data.get('game_name') or 'Battleship'
    mode = data.get('mode') or 'pve'
    invited = (data.get('invited') or '').strip()
    is_private = bool(invited)
    code = _generate_game_code()
    creator_username = current_user.display_name or current_user.username
    invited_username = invited or None
    session_data = {
        'code': code,
        'game_name': game_name,
        'mode': mode,
        'status': 'waiting',
        'is_private': is_private,
        'max_players': 2,
        'creator_id': current_user.id,
        'creator_username': creator_username,
        'invited_username': invited_username,
        'created_at': datetime.now(timezone.utc),
        'players': {},
        'spectators': {},
    }
    session_data['players'][current_user.id] = {
        'username': creator_username,
        'role': 'creator',
        'ready': False,
        'connected_sids': set(),
        'is_human': True,
    }
    with _GAME_SESSIONS_LOCK:
        _GAME_SESSIONS[code] = session_data
    return jsonify({'code': code, 'game': _serialize_game_session(session_data, current_user_id=current_user.id)}), 201

@app.route('/api/games/<code>', methods=['GET'])
@login_required
def get_game(code):
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code)
        if not session_data:
            return jsonify({'error': 'Partie introuvable'}), 404
        if session_data.get('is_private'):
            if session_data.get('creator_id') != current_user.id and session_data.get('invited_username') not in {current_user.username, current_user.display_name}:
                return jsonify({'error': 'Accès refusé à cette partie'}), 403
        payload = _serialize_game_session(session_data, current_user_id=current_user.id)
    return jsonify({'game': payload})

# ============================================
# MESSAGERIE
# ============================================
@app.route('/api/messages/<channel_id>', methods=['GET'])
@login_required
def get_messages(channel_id):
    """Récupère les messages d'un salon (pagination)"""
    before = request.args.get('before')
    limit = min(int(request.args.get('limit', MESSAGES_PER_PAGE)), 100)
    
    query = Message.query.filter_by(channel_id=channel_id, is_deleted=False)
    
    if before:
        # Charger les messages avant un certain ID (scroll infini)
        before_msg = Message.query.get(before)
        if before_msg:
            query = query.filter(Message.created_at < before_msg.created_at)
    
    messages = query.order_by(Message.created_at.desc()).limit(limit).all()
    
    return jsonify({
        'messages': [msg.to_dict() for msg in reversed(messages)],
        'has_more': len(messages) == limit
    })

@app.route('/api/messages/<message_id>', methods=['PUT'])
@login_required
def edit_message(message_id):
    """Édite un message"""
    message = Message.query.get(message_id)
    
    if not message:
        return jsonify({'error': 'Message non trouvé'}), 404
    
    if message.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Permission refusée'}), 403
    
    data = request.get_json()
    message.content = data.get('content', message.content)
    message.is_edited = True
    message.edited_at = datetime.now(timezone.utc)
    
    db.session.commit()
    
    # Émettre l'édition en temps réel
    # CORRECTION : Utiliser str(message.channel_id)
    socketio.emit('message_edited', message.to_dict(), room=str(message.channel_id))
    
    log_action(current_user, ActionType.EDIT_MESSAGE, target_id=message_id,
               target_type='message', details='Édition de message')
    
    return jsonify({'message': 'Message mis à jour', 'data': message.to_dict()})

@app.route('/api/messages/<message_id>', methods=['DELETE'])
@login_required
def delete_message(message_id):
    """Supprime un message (soft delete)"""
    print(f"[DEBUG] Tentative de suppression du message: {message_id} par l'utilisateur: {current_user.id}")
    message = Message.query.get(message_id)
    
    if not message:
        print(f"[ERROR] Message non trouvé pour suppression: {message_id}")
        return jsonify({'error': 'Message non trouvé'}), 404
    
    print(f"[DEBUG] Message trouvé. Auteur: {message.user_id}, Canal: {message.channel_id}")
    
    if message.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Permission refusée'}), 403
    
    channel_id = message.channel_id
    message.is_deleted = True
    message.content = ""
    
    db.session.commit()
    
    # Émettre la suppression en temps réel
    # CORRECTION : Utiliser str(channel_id)
    socketio.emit('message_deleted', {'message_id': message_id}, room=str(channel_id))
    
    log_action(current_user, ActionType.DELETE_MESSAGE, target_id=message_id,
               target_type='message', details='Suppression de message')
    
    return jsonify({'message': 'Message supprimé'})

@app.route('/api/messages/<message_id>/reactions', methods=['POST'])
@login_required
def add_reaction(message_id):
    """Ajoute une réaction à un message"""
    data = request.get_json()
    emoji = data.get('emoji')
    
    if not emoji:
        return jsonify({'error': 'Emoji requis'}), 400
    
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Message non trouvé'}), 404
    
    # Vérifier si la réaction existe déjà
    existing = MessageReaction.query.filter_by(
        message_id=message_id,
        user_id=current_user.id,
        emoji=emoji
    ).first()
    
    if existing:
        # Supprimer la réaction (toggle)
        db.session.delete(existing)
        db.session.commit()
        action = 'removed'
    else:
        # Ajouter la réaction
        reaction = MessageReaction(
            message_id=message_id,
            user_id=current_user.id,
            emoji=emoji
        )
        db.session.add(reaction)
        db.session.commit()
        action = 'added'
    
    # Émettre la mise à jour
    # CORRECTION : Utiliser str(message.channel_id)
    socketio.emit('reaction_updated', {
        'message_id': message_id,
        'reactions': [r.to_dict() for r in message.reactions],
        'action': action,
        'user_id': current_user.id
    }, room=str(message.channel_id))
    
    return jsonify({'message': f'Réaction {action}'})

# ============================================
# MESSAGES ÉPINGLÉS
# ============================================
@app.route('/api/messages/<message_id>/pin', methods=['POST'])
@login_required
def pin_message(message_id):
    msg = Message.query.get(message_id)
    if not msg or msg.is_deleted:
        return jsonify({'error': 'Message non trouvé'}), 404
    if not current_user.is_admin:
        return jsonify({'error': 'Permission refusée'}), 403
    existing = MessagePin.query.filter_by(message_id=message_id).first()
    if existing:
        return jsonify({'message': 'Déjà épinglé', 'pin': existing.to_dict()}), 200
    pin = MessagePin(channel_id=msg.channel_id, message_id=message_id, user_id=current_user.id)
    db.session.add(pin)
    db.session.commit()
    socketio.emit('message_pinned', {'message_id': message_id, 'channel_id': msg.channel_id}, room=str(msg.channel_id))
    return jsonify({'message': 'Message épinglé', 'pin': pin.to_dict()})

@app.route('/api/messages/<message_id>/pin', methods=['DELETE'])
@login_required
def unpin_message(message_id):
    msg = Message.query.get(message_id)
    if not msg:
        return jsonify({'error': 'Message non trouvé'}), 404
    if not current_user.is_admin:
        return jsonify({'error': 'Permission refusée'}), 403
    pin = MessagePin.query.filter_by(message_id=message_id).first()
    if not pin:
        return jsonify({'message': 'Pas épinglé'}), 200
    db.session.delete(pin)
    db.session.commit()
    socketio.emit('message_unpinned', {'message_id': message_id, 'channel_id': msg.channel_id}, room=str(msg.channel_id))
    return jsonify({'message': 'Message désépinglé'})

@app.route('/api/channels/<channel_id>/pins', methods=['GET'])
@login_required
def list_pins(channel_id):
    pins = MessagePin.query.filter_by(channel_id=channel_id).order_by(MessagePin.created_at.desc()).all()
    # Optionnel: joindre le message pour affichage
    result = []
    for p in pins:
        m = Message.query.get(p.message_id)
        result.append({
            'pin': p.to_dict(),
            'message': m.to_dict() if m else None
        })
    return jsonify({'pins': result})

# ============================================
# MESSAGES PRIVÉS (DM)
# ============================================

# ============================================
# MESSAGERIE PRIVÉE COMPLÈTE
# ============================================

@app.route('/api/dm/conversations', methods=['GET'])
@login_required
def list_dm_conversations():
    target_page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 50))
    participant_channels = (
        db.session.query(ChannelParticipant.channel_id)
        .filter_by(user_id=current_user.id)
        .subquery()
    )
    dm_channels = (
        db.session.query(Channel)
        .filter(Channel.id.in_(db.select(participant_channels)), Channel.channel_type == ChannelType.DM)
        .all()
    )
    conversations = []
    for ch in dm_channels:
        last_msg = Message.query.filter_by(channel_id=ch.id, is_deleted=False).order_by(Message.created_at.desc()).first()
        other_participant = ChannelParticipant.query.filter(
            ChannelParticipant.channel_id == ch.id,
            ChannelParticipant.user_id != current_user.id
        ).first()
        other_user = db.session.get(User, other_participant.user_id) if other_participant else None
        conversations.append({
            'channel': ch.to_dict(),
            'other_user': other_user.to_dict(include_sensitive=False) if other_user else None,
            'last_message': last_msg.to_dict() if last_msg else None,
            'last_activity_at': last_msg.created_at.isoformat() if last_msg else (ch.created_at.isoformat() if ch.created_at else None),
            'unread_count': 0
        })
    conversations.sort(key=lambda c: c['last_activity_at'] or '', reverse=True)
    start = (target_page - 1) * per_page
    end = start + per_page
    paged = conversations[start:end]
    return jsonify({
        'conversations': paged,
        'total': len(conversations),
        'page': target_page,
        'per_page': per_page,
        'has_more': end < len(conversations)
    })

@app.route('/api/dm/start', methods=['POST'])
@login_required
def dm_start():
    data = request.get_json() or {}
    target_user_id = data.get('target_user_id')
    if not target_user_id or target_user_id == current_user.id:
        return jsonify({'error': 'Utilisateur cible invalide'}), 400
    target_user = db.session.get(User, target_user_id)
    if not target_user or not target_user.is_active:
        return jsonify({'error': 'Utilisateur introuvable ou inactif'}), 404
    existing = _find_dm_channel(current_user.id, target_user_id)
    if existing:
        last_msg = Message.query.filter_by(channel_id=existing.id, is_deleted=False).order_by(Message.created_at.desc()).first()
        return jsonify({
            'channel': existing.to_dict(),
            'other_user': target_user.to_dict(include_sensitive=False),
            'last_message': last_msg.to_dict() if last_msg else None
        })
    return jsonify({
        'channel': None,
        'other_user': target_user.to_dict(include_sensitive=False)
    })

@app.route('/api/dm/leave', methods=['POST'])
@login_required
def dm_leave():
    data = request.get_json() or {}
    channel_id = data.get('channel_id')
    if not channel_id:
        return jsonify({'error': 'ID de conversation requis'}), 400
    channel = db.session.get(Channel, channel_id)
    if not channel or channel.channel_type != ChannelType.DM:
        return jsonify({'error': 'Conversation introuvable'}), 404
    part = ChannelParticipant.query.filter_by(channel_id=channel_id, user_id=current_user.id).first()
    if part:
        db.session.delete(part)
        db.session.commit()
    system_msg = Message(
        channel_id=channel_id,
        user_id=current_user.id,
        content=f"{current_user.display_name or current_user.username} a quitté la conversation",
        message_type=MessageType.SYSTEM
    )
    db.session.add(system_msg)
    db.session.commit()
    # CORRECTION : Utiliser str() pour la room
    socketio.emit('new_message', system_msg.to_dict(), room=str(channel_id))
    other_part = ChannelParticipant.query.filter(ChannelParticipant.channel_id == channel_id, ChannelParticipant.user_id != current_user.id).first()
    if other_part:
        other_user = db.session.get(User, other_part.user_id)
        emit('dm_conversation_updated', {
            'channel': channel.to_dict(),
            'other_user': other_user.to_dict(include_sensitive=False) if other_user else None,
            'last_message': system_msg.to_dict()
        }, room=f"user_{other_part.user_id}")
    return jsonify({'message': 'Conversation quittée'})

def _find_dm_channel(user_a_id, user_b_id):
    subq = ChannelParticipant.query.filter(ChannelParticipant.user_id.in_([user_a_id, user_b_id]))\
        .with_entities(ChannelParticipant.channel_id).subquery()
    candidates = (
        db.session.query(Channel)
        .filter(Channel.id.in_(db.select(subq)), Channel.channel_type == ChannelType.DM)
        .all()
    )
    for ch in candidates:
        users = set(p.user_id for p in ChannelParticipant.query.filter_by(channel_id=ch.id).all())
        if users == {user_a_id, user_b_id}:
            return ch
    return None











# ============================================
# UPLOAD DE FICHIERS
# ============================================
@app.route('/api/upload', methods=['POST'])
@login_required
def upload_file():
    """Upload d'un fichier"""
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier fourni'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'Nom de fichier vide'}), 400
    
    if file and allowed_file(file.filename):
        try:
            # Générer un nom de fichier unique
            original_filename = secure_filename(file.filename)
            ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
            unique_filename = f"{uuid.uuid4().hex}.{ext}"
            
            # Déterminer le type de fichier
            file_type = get_file_type(original_filename)
            
            # =================================================================
            # LOGIQUE DE DOSSIER DÉDIÉ PAR CONVERSATION
            # =================================================================
            channel_id = request.form.get('channel_id')
            dm_target_user_id = request.form.get('dm_target_user_id')
            
            # Si pas d'ID de canal mais un ID utilisateur cible (DM)
            if not channel_id and dm_target_user_id:
                # Chercher le canal DM existant
                dm_channel = _find_dm_channel(current_user.id, dm_target_user_id)
                
                # Si pas trouvé, on le crée IMMÉDIATEMENT pour avoir un dossier
                if not dm_channel:
                    target_user = db.session.get(User, dm_target_user_id)
                    if target_user and target_user.is_active:
                        dm_channel = Channel(
                            name=f"DM-{current_user.username}-{target_user.username}",
                            channel_type=ChannelType.DM,
                            category="Privé"
                        )
                        db.session.add(dm_channel)
                        db.session.commit()
                        
                        p1 = ChannelParticipant(channel_id=dm_channel.id, user_id=current_user.id)
                        p2 = ChannelParticipant(channel_id=dm_channel.id, user_id=target_user.id)
                        db.session.add(p1)
                        db.session.add(p2)
                        db.session.commit()
                        
                        # Notifier la création (via socket externe)
                        try:
                            socketio.emit('dm_conversation_created', {
                                'channel': dm_channel.to_dict(),
                                'other_user': current_user.to_dict(include_sensitive=False),
                            }, room=f"user_{target_user.id}")
                        except:
                            pass

                if dm_channel:
                    channel_id = dm_channel.id

            # Définir le chemin en fonction du canal
            relative_folder = ""
            if channel_id:
                channel = db.session.get(Channel, channel_id)
                if channel:
                    if channel.channel_type == ChannelType.DM:
                        # 1 dossier par conversation privée
                        relative_folder = f"private/{channel.id}"
                    else:
                        # Dossier dédié pour les chaînes publiques
                        relative_folder = f"channels/{channel.id}"
            
            # Fallback date si pas de canal identifié
            if not relative_folder:
                now = datetime.now(timezone.utc)
                relative_folder = now.strftime('%Y/%m')

            user_path = FILES_DIR / relative_folder
            
            try:
                user_path.mkdir(parents=True, exist_ok=True)
            except PermissionError:
                # Fallback: utiliser le dossier racine
                user_path = FILES_DIR
                relative_folder = ""
            
            file_path = user_path / unique_filename
            
            # Sauvegarder le fichier
            file.save(str(file_path))
            
            # Obtenir la taille du fichier
            try:
                file_size = os.path.getsize(str(file_path))
            except:
                file_size = file.tell()
            
            # Créer l'enregistrement en base
            # Le filename stocké doit inclure le chemin relatif pour l'accès futur
            stored_filename = f"{relative_folder}/{unique_filename}" if relative_folder else unique_filename
            
            file_record = FileAttachment(
                uploader_id=current_user.id,
                channel_id=channel_id if channel_id else None,
                filename=stored_filename,
                original_filename=original_filename,
                file_type=file_type,
                file_size=file_size,
                file_path=str(file_path)
            )
            
            db.session.add(file_record)
            db.session.commit()
            
            log_action(current_user, ActionType.UPLOAD_FILE, target_id=file_record.id,
                       target_type='file', details=f'Upload: {original_filename}')
            
            return jsonify({
                'message': 'Fichier uploadé',
                'file': file_record.to_dict(),
                'channel_id': channel_id
            }), 201
            
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': f'Erreur lors de l\'upload: {str(e)}'}), 500
    
    return jsonify({'error': 'Type de fichier non autorisé'}), 400

@app.route('/api/upload/avatar', methods=['POST'])
@login_required
def upload_avatar():
    """Upload d'un avatar"""
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier fourni'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'Nom de fichier vide'}), 400
    
    # Vérifier que c'est une image
    allowed_image_exts = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
    ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
    
    if ext not in allowed_image_exts:
        return jsonify({'error': 'Type de fichier non autorisé pour l\'avatar. Utilisez: JPG, PNG, GIF ou WebP'}), 400
    
    try:
        # Générer un nom de fichier unique avec l'ID utilisateur
        unique_filename = f"{current_user.id}_{uuid.uuid4().hex}.{ext}"
        
        # Créer le dossier avatars si nécessaire
        AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        app.logger.info(f"upload_avatar: AVATARS_DIR={AVATARS_DIR}")
        
        file_path = AVATARS_DIR / unique_filename
        
        # Traitement selon l'extension (éviter d'enregistrer du JPEG avec une extension PNG/WebP)
        if ext in ('jpg', 'jpeg', 'png'):
            try:
                from PIL import Image
                # Ouvrir l'image
                img = Image.open(file)
                # Redimensionner à 200x200 max, conserver proportions
                img.thumbnail((200, 200), Image.Resampling.LANCZOS)
                # Choisir le format de sortie cohérent avec l'extension
                if ext in ('jpg', 'jpeg'):
                    # JPEG n'accepte pas l'alpha
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    img.save(str(file_path), 'JPEG', quality=85, optimize=True)
                elif ext == 'png':
                    # Préserver alpha si présent
                    img.save(str(file_path), 'PNG', optimize=True)
            except ImportError:
                # Pillow indisponible: sauvegarde brute
                file.save(str(file_path))
            except Exception as e:
                # Tout autre problème d'image -> tentative de sauvegarde brute puis rapport détaillé si échec
                try:
                    file.stream.seek(0, os.SEEK_SET)
                except Exception:
                    pass
                try:
                    file.save(str(file_path))
                except Exception as save_err:
                    return jsonify({'error': f"Erreur lors de l’enregistrement de l'avatar: {save_err} (path={file_path})"}), 500
        else:
            # GIF/WEBP: on ne modifie pas pour préserver l'animation/qualité
            try:
                file.save(str(file_path))
            except Exception as e:
                return jsonify({'error': f"Erreur lors de l’enregistrement de l'avatar: {e} (path={file_path})"}), 500
        
        # Limite de taille de sécurité pour les sauvegardes brutes
        max_size = 4 * 1024 * 1024  # 4MB
        if file_path.stat().st_size > max_size:
            file_path.unlink(missing_ok=True)
            return jsonify({'error': 'Avatar trop volumineux (max 4MB)'}), 400
        
        # Supprimer l'ancien avatar si c'est pas le défaut
        if current_user.avatar_filename and current_user.avatar_filename != 'default_avatar.svg':
            old_path = AVATARS_DIR / current_user.avatar_filename
            if old_path.exists():
                try:
                    old_path.unlink()
                except:
                    pass
        
        # Mettre à jour l'utilisateur
        current_user.avatar_filename = unique_filename
        db.session.commit()
        
        log_action(current_user, ActionType.UPLOAD_FILE, target_id=current_user.id,
                   target_type='avatar', details=f'Nouvel avatar: {unique_filename}')
        
        return jsonify({
            'message': 'Avatar mis à jour',
            'avatar_url': f"/uploads/avatars/{unique_filename}"
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Erreur lors de l\'upload de l\'avatar: {str(e)}'}), 500

@app.route('/uploads/avatars/<filename>')
def serve_avatar(filename):
    """Sert les avatars"""
    # Vérifier que le fichier existe
    file_path = AVATARS_DIR / filename
    if not file_path.exists():
        # Servir l'avatar par défaut depuis le dossier static/icons
        fallback_dir = os.path.join(app.static_folder or 'static', 'icons')
        return send_from_directory(fallback_dir, 'default_avatar.svg')
    return send_from_directory(str(AVATARS_DIR), filename)

@app.route('/uploads/banners/<filename>')
def serve_banner(filename):
    """Sert les bannières"""
    # Vérifier que le fichier existe
    file_path = BANNERS_DIR / filename
    if not file_path.exists():
        return jsonify({'error': 'Bannière non trouvée'}), 404
    return send_from_directory(str(BANNERS_DIR), filename)

@app.route('/uploads/files/<path:filename>')
def serve_file(filename):
    """Sert les fichiers uploadés avec le nom original préservé"""
    from urllib.parse import unquote
    from pathlib import Path
    
    # Tentative 1: Chercher par ID (UUID) dans la base de données
    file_record = FileAttachment.query.get(filename)
    
    if file_record:
        # Le filename était l'UUID du fichier
        file_path = file_record.file_path
        original_name = unquote(file_record.original_filename)
        
        # Vérifier si le fichier existe physiquement
        if os.path.exists(file_path):
            file_dir = os.path.dirname(file_path)
            actual_filename = os.path.basename(file_path)
            return send_from_directory(
                file_dir, 
                actual_filename,
                download_name=original_name
            )
        else:
            return jsonify({'error': 'Fichier non trouvé sur le serveur'}), 404
    
    # Tentative 2: Chercher par filename dans la base de données
    # Le filename peut contenir des slashes, donc on cherche par like
    file_record = FileAttachment.query.filter(FileAttachment.filename.endswith(filename.replace('/', '%'))).first()
    
    if file_record and os.path.exists(file_record.file_path):
        file_dir = os.path.dirname(file_record.file_path)
        actual_filename = os.path.basename(file_record.file_path)
        original_name = unquote(file_record.original_filename)
        return send_from_directory(
            file_dir, 
            actual_filename,
            download_name=original_name
        )
    
    # Tentative 3: Servir directement depuis FILES_DIR (chemin simple sans sous-dossiers)
    # Nettoyer le filename et essayer de le trouver
    clean_filename = filename.split('/')[-1]  # Prendre juste le nom du fichier
    direct_path = FILES_DIR / clean_filename
    if os.path.exists(str(direct_path)):
        return send_from_directory(str(FILES_DIR), clean_filename, download_name=clean_filename)
    
    # Tentative 4: Essayer avec le chemin complet dans FILES_DIR
    if os.path.exists(str(FILES_DIR / filename)):
        return send_from_directory(str(FILES_DIR), filename)
    
    # Aucune méthode n'a fonctionné
    return jsonify({'error': 'Fichier non trouvé'}), 404

@app.route('/api/files/history', methods=['GET'])
@login_required
def get_file_history():
    """Récupère l'historique complet des fichiers uploadés"""
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 50))
        channel_id = request.args.get('channel_id')
        
        query = FileAttachment.query
        if channel_id:
            query = query.outerjoin(Message, FileAttachment.message_id == Message.id).filter(
                (FileAttachment.channel_id == channel_id) | (Message.channel_id == channel_id)
            )
        else:
            # SÉCURITÉ : Si aucun canal spécifié, retourner UNIQUEMENT les fichiers des canaux PUBLICS
            # Cela empêche la fuite de fichiers privés/DM dans la vue globale
            query = query.join(Channel, FileAttachment.channel_id == Channel.id).filter(
                Channel.channel_type == ChannelType.PUBLIC
            )
        
        files = query.order_by(FileAttachment.created_at.desc())\
            .offset((page - 1) * per_page).limit(per_page).all()
        
        total = (query.count())
        
        return jsonify({
            'files': [f.to_dict() for f in files],
            'page': page,
            'per_page': per_page,
            'total': total,
            'has_more': (page * per_page) < total
        })
    except Exception as e:
        return jsonify({'error': str(e), 'files': [], 'total': 0}), 200

@app.route('/api/files/<file_id>', methods=['GET'])
@login_required
def get_file_info(file_id):
    """Récupère les informations d'un fichier spécifique"""
    file_record = FileAttachment.query.get(file_id)
    
    if not file_record:
        return jsonify({'error': 'Fichier non trouvé'}), 404
    
    return jsonify({'file': file_record.to_dict()})

# ============================================
# MODÉRATION
# ============================================
@app.route('/api/admin/users', methods=['GET'])
@admin_required
def list_users():
    """Liste tous les utilisateurs"""
    users = User.query.all()
    return jsonify({'users': [u.to_dict(include_sensitive=True) for u in users]})

@app.route('/api/admin/users/<user_id>/ban', methods=['POST'])
@admin_required
def ban_user(user_id):
    """Bannit un utilisateur (désactive le compte)"""
    if user_id == current_user.id:
        return jsonify({'error': 'Vous ne pouvez pas vous bannir vous-même'}), 400
    
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    if user.is_supreme and not current_user.is_supreme:
        return jsonify({'error': 'Impossible de bannir l\'Admin Suprême'}), 403
    
    # Récupérer la raison du ban (optionnelle)
    data = request.get_json(silent=True) or {}
    reason = data.get('reason', 'Votre compte a été désactivé par un administrateur')
    
    # Enregistrer les informations de ban
    user.set_ban_info(reason, current_user.id)
    db.session.commit()
    
    # Déconnecter l'utilisateur banni et l'avertir via SocketIO
    presence = OnlinePresence.query.filter_by(user_id=user_id).first()
    if presence:
        socketio.emit('banned', {
            'reason': reason,
            'banned_by': current_user.username
        }, room=presence.socket_id)
        safe_disconnect(presence.socket_id)
    
    # Émettre l'événement à tous les autres utilisateurs
    socketio.emit('user_banned', {
        'user_id': user_id,
        'username': user.username,
        'reason': reason,
        'banned_by': current_user.username
    })
    
    log_action(current_user, ActionType.BAN_USER, target_id=user_id,
               target_type='user', details=f'Bannissement de @{user.username}: {reason}')
    
    return jsonify({'message': f'@{user.username} a été banni', 'reason': reason})

@app.route('/api/admin/users/<user_id>/unban', methods=['POST'])
@admin_required
def unban_user(user_id):
    """Débannit un utilisateur"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    # Récupérer la raison du ban actuel pour l'historique
    old_reason = user.ban_reason or 'Raison non spécifiée'
    
    # Effacer les informations de ban
    user.clear_ban_info()
    db.session.commit()
    
    #Notifier l'utilisateur débanni via SocketIO
    presence = OnlinePresence.query.filter_by(user_id=user_id).first()
    if presence:
        socketio.emit('unbanned', {
            'reason': f'Votre compte a été rétabli par {current_user.username}',
            'unbanned_by': current_user.username,
            'old_ban_reason': old_reason
        }, room=presence.socket_id)
    
    # Avertir l'utilisateur恢复 via SocketIO
    socketio.emit('user_unbanned', {
        'message': 'Votre compte a été rétabli',
        'unbanned_by': current_user.username
    }, room=f"user_{user_id}")
    
    # Émettre l'événement à tous les autres utilisateurs
    socketio.emit('user_unbanned_broadcast', {
        'user_id': user_id,
        'username': user.username,
        'unbanned_by': current_user.username
    })
    
    log_action(current_user, ActionType.UNBAN_USER, target_id=user_id,
               target_type='user', details=f'Débannissement de @{user.username}')
    
    return jsonify({'message': f'@{user.username} a été rétabli'})

@app.route('/api/admin/users/<user_id>/shadowban', methods=['POST'])
@admin_required
def shadowban_user(user_id):
    """Shadowban un utilisateur"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    if user.is_supreme and not current_user.is_supreme:
        return jsonify({'error': 'Impossible de shadowbannir l\'Admin Suprême'}), 403
    
    user.is_shadowbanned = not user.is_shadowbanned
    db.session.commit()
    
    action = 'shadowban' if user.is_shadowbanned else 'unshadowban'
    log_action(current_user, action.upper(), target_id=user_id,
               target_type='user', details=f'{action} de @{user.username}')
    
    return jsonify({'message': f'@{user.username} a été {"shadowbanné" if user.is_shadowbanned else "dé-shadowbanné"}'})

@app.route('/api/admin/users/<user_id>/mute', methods=['POST'])
@admin_required
def mute_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    if user.is_supreme and not current_user.is_supreme:
        return jsonify({'error': 'Impossible de mute l\'Admin Suprême'}), 403
    data = request.get_json(silent=True) or {}
    seconds = int(data.get('seconds', 0) or 0)
    if seconds <= 0:
        return jsonify({'error': 'Durée invalide'}), 400
    now = get_current_utc_time()
    base = user.mute_until if user.mute_until and user.mute_until > now else now
    user.mute_until = base + timedelta(seconds=seconds)
    db.session.commit()
    presence = OnlinePresence.query.filter_by(user_id=user_id).first()
    mute_until_int = int(user.mute_until.timestamp())
    _ANTISPAM_MUTES[user.id] = mute_until_int
    if presence:
        socketio.emit('mute_state', {'mute_until': mute_until_int}, room=presence.socket_id)
    socketio.emit('mute_state', {'mute_until': mute_until_int}, room=f"user_{user_id}")
    log_action(current_user, 'MUTE_USER', target_id=user_id,
               target_type='user', details=f'Mute de @{user.username} pour {seconds} secondes')
    return jsonify({'message': f'@{user.username} est mute', 'mute_until': user.mute_until.isoformat()})

@app.route('/api/admin/users/<user_id>/unmute', methods=['POST'])
@admin_required
def unmute_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    user.mute_until = None
    db.session.commit()
    _ANTISPAM_MUTES.pop(user.id, None)
    presence = OnlinePresence.query.filter_by(user_id=user_id).first()
    if presence:
        socketio.emit('mute_state', {'mute_until': None}, room=presence.socket_id)
    socketio.emit('mute_state', {'mute_until': None}, room=f"user_{user_id}")
    log_action(current_user, 'UNMUTE_USER', target_id=user_id,
               target_type='user', details=f'Unmute de @{user.username}')
    return jsonify({'message': f'@{user.username} n\'est plus mute'})

@app.route('/api/admin/users/<user_id>/kick', methods=['POST'])
@admin_required
def kick_user(user_id):
    """Expulse un utilisateur (déconnexion forcée) avec redirection personnalisée"""
    if user_id == current_user.id:
        return jsonify({'error': 'Vous ne pouvez pas vous expulser'}), 400
    
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    # Récupérer l'URL de redirection personnalisée (optionnelle)
    data = request.get_json(silent=True) or {}
    redirect_url = data.get('redirect_url', '/login')
    
    # Déconnecter via Socket.IO avec l'URL de redirection
    presence = OnlinePresence.query.filter_by(user_id=user_id).first()
    if presence:
        socketio.emit('kicked', {
            'reason': 'Vous avez été expulsé par un administrateur',
            'redirect_url': redirect_url
        }, room=presence.socket_id)
        safe_disconnect(presence.socket_id)
    
    log_action(current_user, ActionType.KICK, target_id=user_id,
               target_type='user', details=f'Expulsion de @{user.username} vers {redirect_url}')
    
    return jsonify({
        'message': f'@{user.username} a été expulsé',
        'redirect_url': redirect_url
    })

@app.route('/api/admin/users/<user_id>/promote', methods=['POST'])
@admin_required
def promote_user(user_id):
    """Promouvoir un utilisateur"""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    # Seul l'admin supreme peut promouvoir au rang admin/supreme
    if current_user.is_supreme:
        new_role = request.args.get('role', UserRole.ADMIN)
        if new_role not in [UserRole.ADMIN, UserRole.MODERATOR]:
            return jsonify({'error': 'Rôle invalide'}), 400
        user.role = new_role
    else:
        if user.role == UserRole.ADMIN or user.role == UserRole.SUPREME:
            return jsonify({'error': 'Impossible de modifier ce rôle sans droits suffisants'}), 403
        user.role = UserRole.MODERATOR
    
    db.session.commit()
    
    socketio.emit('role_change', {
        'user_id': user.id,
        'username': user.username,
        'new_role': user.role,
        'performed_by': current_user.id
    })
    try:
        admin_channel = Channel.query.filter_by(name='admin').first()
        if admin_channel and user.role in [UserRole.ADMIN, UserRole.SUPREME]:
            if user.role == UserRole.SUPREME:
                msg_content = f"{user.display_name} est maintenant Admin Suprême"
            else:
                msg_content = f"{user.display_name} est maintenant Administrateur"
            system_message = Message(
                channel_id=admin_channel.id,
                user_id=current_user.id,
                content=msg_content,
                message_type='system'
            )
            db.session.add(system_message)
            db.session.commit()
            socketio.emit('new_message', system_message.to_dict(), room=str(admin_channel.id))
            joined_msg = Message(
                channel_id=admin_channel.id,
                user_id=current_user.id,
                content=f"{user.display_name} a rejoint le salon admin",
                message_type='system'
            )
            db.session.add(joined_msg)
            db.session.commit()
            socketio.emit('new_message', joined_msg.to_dict(), room=str(admin_channel.id))
        general_channel = Channel.query.filter_by(name='général').first()
        if not general_channel:
            general_channel = Channel.query.filter_by(name='Général').first()
        if general_channel and user.role in [UserRole.ADMIN, UserRole.SUPREME]:
            if user.role == UserRole.SUPREME:
                general_msg = f"{user.display_name} est maintenant Admin Suprême"
            else:
                general_msg = f"{user.display_name} est maintenant Administrateur"
            general_system_message = Message(
                channel_id=general_channel.id,
                user_id=current_user.id,
                content=general_msg,
                message_type='system'
            )
            db.session.add(general_system_message)
            db.session.commit()
            socketio.emit('new_message', general_system_message.to_dict(), room=str(general_channel.id))
    except Exception as e:
        print(f"[Warning] Impossible d'émettre le message de promotion admin: {e}")
    
    log_action(current_user, ActionType.PROMOTE, target_id=user_id,
               target_type='user', details=f'Promotion de @{user.username} au rang {user.role}')
    
    return jsonify({
        'message': f'@{user.username} est maintenant {user.role}',
        'user': user.to_dict()
    })

@app.route('/api/admin/users/<user_id>/demote', methods=['POST'])
@admin_required
def demote_user(user_id):
    """Rétrograder un utilisateur"""
    if user_id == current_user.id:
        return jsonify({'error': 'Vous ne pouvez pas vous rétrograder'}), 400
    
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    if user.is_supreme:
        return jsonify({'error': 'Impossible de rétrograder l\'Admin Suprême'}), 403
    
    user.role = UserRole.MEMBER
    db.session.commit()
    
    # Émettre l'événement de changement de rôle à tous les clients
    socketio.emit('role_change', {
        'user_id': user.id,
        'username': user.username,
        'new_role': user.role,
        'performed_by': current_user.id
    })
    
    try:
        admin_channel = Channel.query.filter_by(name='admin').first()
        if admin_channel:
            leave_msg = Message(
                channel_id=admin_channel.id,
                user_id=current_user.id,
                content=f"{user.display_name} a quitté le salon admin",
                message_type='system'
            )
            db.session.add(leave_msg)
            db.session.commit()
            socketio.emit('new_message', leave_msg.to_dict(), room=str(admin_channel.id))
    except Exception as e:
        print(f"[Warning] Impossible d'émettre le message de départ admin: {e}")
    log_action(current_user, ActionType.DEMOTE, target_id=user_id,
               target_type='user', details=f'Rétrogradation de @{user.username}')
    
    return jsonify({
        'message': f'@{user.username} est maintenant membre',
        'user': user.to_dict()
    })

@app.route('/api/admin/users/<user_id>/unadmin', methods=['POST'])
@admin_required
def unadmin_user(user_id):
    """Retirer les droits Admin à un utilisateur (le réduire au rang MEMBER)"""
    if user_id == current_user.id:
        return jsonify({'error': 'Vous ne pouvez pas vous retirer vos droits admin'}), 400
    
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'Utilisateur non trouvé'}), 404
    
    if user.is_supreme:
        return jsonify({'error': 'Impossible de modifier l\'Admin Suprême'}), 403
    
    if not user.is_admin:
        return jsonify({'error': 'Cet utilisateur n\'est pas admin'}), 400
    
    user.role = UserRole.MEMBER
    db.session.commit()
    
    # Émettre l'événement de changement de rôle à tous les clients
    socketio.emit('role_change', {
        'user_id': user.id,
        'username': user.username,
        'new_role': user.role,
        'performed_by': current_user.id
    })
    
    try:
        admin_channel = Channel.query.filter_by(name='admin').first()
        if admin_channel:
            leave_msg = Message(
                channel_id=admin_channel.id,
                user_id=current_user.id,
                content=f"{user.display_name} a quitté le salon admin",
                message_type='system'
            )
            db.session.add(leave_msg)
            db.session.commit()
            socketio.emit('new_message', leave_msg.to_dict(), room=str(admin_channel.id))
    except Exception as e:
        print(f"[Warning] Impossible d'émettre le message de départ admin: {e}")
    log_action(current_user, ActionType.DEMOTE, target_id=user_id,
               target_type='user', details=f'Retrait des droits admin de @{user.username}')
    
    return jsonify({
        'message': f'@{user.username} n\'est plus admin',
        'user': user.to_dict()
    })

@app.route('/api/admin/banned-ips', methods=['GET'])
@admin_required
def list_banned_ips():
    """Liste les IPs bannies"""
    banned = BannedIP.query.all()
    return jsonify({'banned_ips': [b.to_dict() for b in banned]})

@app.route('/api/admin/banned-ips', methods=['POST'])
@admin_required
def ban_ip():
    """Banne une IP"""
    data = request.get_json()
    ip = data.get('ip_address')
    
    if not ip:
        return jsonify({'error': 'Adresse IP requise'}), 400
    
    existing = BannedIP.query.filter_by(ip_address=ip).first()
    if existing:
        return jsonify({'error': 'Cette IP est déjà bannie'}), 400
    
    banned = BannedIP(
        ip_address=ip,
        reason=data.get('reason'),
        banned_by=current_user.id
    )
    
    db.session.add(banned)
    db.session.commit()
    
    log_action(current_user, ActionType.BAN_IP, target_id=ip,
               target_type='ip', details=f'Ban IP: {ip}')
    
    return jsonify({'message': f'IP {ip} bannie'})

@app.route('/api/admin/banned-ips/<ip>', methods=['DELETE'])
@admin_required
def unban_ip(ip):
    """Débannit une IP"""
    banned = BannedIP.query.filter_by(ip_address=ip).first()
    if not banned:
        return jsonify({'error': 'Cette IP n\'est pas bannie'}), 404
    
    db.session.delete(banned)
    db.session.commit()
    
    log_action(current_user, ActionType.UNBAN_IP, target_id=ip,
               target_type='ip', details=f'Déban IP: {ip}')
    
    return jsonify({'message': f'IP {ip} débannie'})

@app.route('/api/admin/logs', methods=['GET'])
@admin_required
def get_logs():
    """Récupère le journal d'audit"""
    page = int(request.args.get('page', 1))
    per_page = 50
    
    logs = AuditLog.query.order_by(AuditLog.created_at.desc())\
        .offset((page - 1) * per_page).limit(per_page).all()
    
    return jsonify({
        'logs': [l.to_dict() for l in logs],
        'page': page
    })

@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def get_stats():
    """Statistiques du serveur"""
    try:
        user_count = User.query.count()
        channel_count = Channel.query.count()
        message_count = Message.query.count()
        file_count = FileAttachment.query.count()
        
        # Calculer l'espace disque utilisé avec gestion d'erreurs
        total_size = 0
        try:
            for path in [UPLOADS_DIR, DATA_DIR]:
                if path.exists() and path.is_dir():
                    for root, dirs, files in os.walk(path):
                        for f in files:
                            try:
                                file_full_path = os.path.join(root, f)
                                if os.path.exists(file_full_path):
                                    total_size += os.path.getsize(file_full_path)
                            except (PermissionError, OSError):
                                continue
        except (PermissionError, OSError):
            pass  # Ignorer les erreurs de permissions pour les stats
        
        online_count = OnlinePresence.query.filter(
            OnlinePresence.last_ping > datetime.now(timezone.utc) - timedelta(minutes=5)
        ).count()
        
        return jsonify({
            'users': user_count,
            'channels': channel_count,
            'messages': message_count,
            'files': file_count,
            'disk_used': total_size,
            'online_users': online_count
        })
    except Exception as e:
        return jsonify({'error': str(e), 'users': 0, 'channels': 0, 'messages': 0, 'files': 0, 'disk_used': 0, 'online_users': 0})

# ============================================
# SOCKET.IO - TEMPS RÉEL
# ============================================
@socketio.on('connect')
def handle_connect(auth=None):
    """Connexion WebSocket avec vérification Auto-Admin par IP"""
    ip = get_client_ip()
    
    # Vérifier si l'IP est bannie
    if is_ip_banned(ip):
        emit('error', {'message': 'Accès refusé'})
        disconnect()
        return
    
    # Vérifier l'authentification via la session Flask
    if not current_user.is_authenticated:
        emit('error', {'message': 'Authentification requise'})
        disconnect()
        return
    
    # Enregistrer l'IP de connexion
    current_user.last_ip = ip
    current_user.last_seen = datetime.now(timezone.utc)
    db.session.commit()
    
    # =================================================================
    # ROBUSTESSE : Rejoindre automatiquement tous les salons publics
    # =================================================================
    # Cela garantit que l'utilisateur reçoit les messages même s'il n'a pas encore cliqué sur le salon
    try:
        public_channels = Channel.query.filter_by(channel_type=ChannelType.PUBLIC).all()
        for channel in public_channels:
            # Vérifier si c'est le salon admin et si l'utilisateur est admin
            if channel.name == 'admin' and not current_user.is_admin:
                continue
                
            join_room(str(channel.id))
            # print(f"[DEBUG] Auto-joined public channel {channel.name} ({channel.id})")
    except Exception as e:
        print(f"[ERROR] Failed to auto-join public channels: {e}")
    
    # =================================================================
    # AUTO-ADMIN PAR IP : Vérification si l'IP correspond au serveur
    # =================================================================
    # L'utilisateur devient automatiquement admin si :
    # 1. Son IP correspond à l'IP du serveur (localhost ou IP configurée)
    # 2. Ou si ADMIN_SUPREME_IP est configuré et correspond
    
    is_auto_admin = False
    auto_admin_reason = None
    
    # Vérifier les IPs locales du serveur
    local_server_ips = ['127.0.0.1', 'localhost', '::1', '0.0.0.0']
    
    # Si l'utilisateur se connecte depuis une IP locale (serveur)
    if ip in local_server_ips:
        if current_user.role not in [UserRole.SUPREME, UserRole.ADMIN]:
            current_user.role = UserRole.ADMIN
            is_auto_admin = True
            auto_admin_reason = "IP locale du serveur"
    
    # Vérifier si l'IP correspond à ADMIN_SUPREME_IP dans la config
    if ADMIN_SUPREME_IP and ip == ADMIN_SUPREME_IP:
        if current_user.role != UserRole.SUPREME:
            current_user.role = UserRole.SUPREME
            is_auto_admin = True
            auto_admin_reason = f"IP Admin Suprême ({ADMIN_SUPREME_IP})"
    
    if is_auto_admin:
        db.session.commit()
        print(f"[SocketIO] {current_user.username} promu Admin automatiquement via {auto_admin_reason} (IP: {ip})")
        try:
            admin_channel = Channel.query.filter_by(name='admin').first()
            if admin_channel and current_user.role in [UserRole.ADMIN, UserRole.SUPREME]:
                if current_user.role == UserRole.SUPREME:
                    msg_content = f"{current_user.display_name} est maintenant Admin Suprême"
                else:
                    msg_content = f"{current_user.display_name} est maintenant Administrateur"
                system_message = Message(
                    channel_id=admin_channel.id,
                    user_id=current_user.id,
                    content=msg_content,
                    message_type='system'
                )
                db.session.add(system_message)
                db.session.commit()
                socketio.emit('new_message', system_message.to_dict(), room=str(admin_channel.id))
            general_channel = Channel.query.filter_by(name='général').first()
            if not general_channel:
                general_channel = Channel.query.filter_by(name='Général').first()
            if general_channel and current_user.role in [UserRole.ADMIN, UserRole.SUPREME]:
                if current_user.role == UserRole.SUPREME:
                    general_msg = f"{current_user.display_name} est maintenant Admin Suprême"
                else:
                    general_msg = f"{current_user.display_name} est maintenant Administrateur"
                general_system_message = Message(
                    channel_id=general_channel.id,
                    user_id=current_user.id,
                    content=general_msg,
                    message_type='system'
                )
                db.session.add(general_system_message)
                db.session.commit()
                socketio.emit('new_message', general_system_message.to_dict(), room=str(general_channel.id))
        except Exception as e:
            print(f"[Warning] Impossible d'émettre le message de promotion auto-admin: {e}")
        # Informer l'utilisateur de sa promotion
        emit('auto_promoted', {
            'role': current_user.role,
            'reason': auto_admin_reason
        })
    
    # Rejoindre la room de l'utilisateur
    join_room(f"user_{current_user.id}")
    
    # Enregistrer la présence
    presence = OnlinePresence.query.filter_by(user_id=current_user.id).first()
    if presence:
        presence.socket_id = request.sid
        presence.last_ping = datetime.now(timezone.utc)
        presence.status = 'online'
    else:
        presence = OnlinePresence(
            user_id=current_user.id,
            socket_id=request.sid,
            status='online'
        )
        db.session.add(presence)
    
    db.session.commit()
    
    # Émettre l'événement de connexion à tous
    emit('user_connected', current_user.to_dict(), broadcast=True)
    
    print(f"[SocketIO] Utilisateur {current_user.username} connecté (SID: {request.sid}, IP: {ip})")
    try:
        now_ts = int(time.time())
        db_mute_until_ts = 0
        if getattr(current_user, 'mute_until', None):
            try:
                db_mute_until_ts = int(current_user.mute_until.timestamp())
            except Exception:
                db_mute_until_ts = 0
        antispam_mute_ts = int(_ANTISPAM_MUTES.get(current_user.id, 0) or 0)
        mute_until = max(db_mute_until_ts, antispam_mute_ts)
        if mute_until > now_ts:
            _ANTISPAM_MUTES[current_user.id] = mute_until
            emit('mute_state', {'mute_until': mute_until})
    except Exception as e:
        print(f"[ANTISPAM] mute_state sync error: {e}")

@socketio.on('antispam_appeal')
def handle_antispam_appeal(data):
    """Réception d'un appel utilisateur pour faux positif"""
    reason_text = (data or {}).get('reason', '')
    print(f"[ANTISPAM] Appeal reçu de user {current_user.id}: {reason_text}")
    # Notifier les admins
    try:
        admins = User.query.filter(User.role.in_([UserRole.ADMIN, UserRole.SUPREME])).all()
        for admin in admins:
            emit('antispam_appeal', {
                'from_user': current_user.to_dict(),
                'reason': reason_text,
                'ts': datetime.now(timezone.utc).isoformat()
            }, room=f"user_{admin.id}")
    except Exception as e:
        print(f"[ANTISPAM] Erreur notification appeal: {e}")

# Ensemble global pour stocker les sockets abonnés aux mises à jour de fichiers - OBSOLÈTE
# file_updates_subscribers = set()

@socketio.on('ping')
def handle_ping():
    """Ping pour maintenir la présence活跃"""
    try:
        presence = OnlinePresence.query.filter_by(user_id=current_user.id).first()
        if presence:
            presence.last_ping = datetime.now(timezone.utc)
            presence.status = 'online'
            db.session.commit()
        emit('pong', {'status': 'ok', 'timestamp': datetime.now(timezone.utc).isoformat()})
    except OperationalError as e:
        print(f"[DB OPERATIONAL ERROR][ping] {e}")

# @socketio.on('subscribe_file_updates')
# def handle_subscribe_file_updates(data):
#     """Permet aux clients de s'abonner aux mises à jour de fichiers en temps réel"""
#     pass

@socketio.on('status_change')
def handle_status_change(data):
    """Changer le statut de l'utilisateur"""
    new_status = data.get('status', 'online')
    if new_status not in ['online', 'away', 'dnd', 'offline']:
        new_status = 'online'
    
    presence = OnlinePresence.query.filter_by(user_id=current_user.id).first()
    if presence:
        presence.status = new_status
        db.session.commit()
    
    emit('user_status_changed', {
        'user_id': current_user.id,
        'status': new_status
    }, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    """Déconnexion WebSocket"""
    # Retirer le socket des abonnés aux mises à jour de fichiers - OBSOLÈTE
    # file_updates_subscribers.discard(request.sid)
    
    _game_cleanup_for_sid(request.sid)
    presence = OnlinePresence.query.filter_by(socket_id=request.sid).first()
    if presence:
        user_id = presence.user_id
        user = db.session.get(User, user_id)
        
        # Supprimer la présence
        db.session.delete(presence)
        db.session.commit()
        
        # Émettre la déconnexion à tous
        emit('user_disconnected', {
            'user_id': user_id,
            'username': user.username if user else None
        }, broadcast=True)

@socketio.on('join_channel')
def handle_join_channel(data):
    """Rejoint un salon"""
    channel_id = data.get('channel_id')
    
    if not channel_id:
        return
    
    channel = db.session.get(Channel, channel_id)
    if not channel:
        emit('error', {'message': 'Salon non trouvé'})
        return
    
    # Vérifier l'accès au salon
    if channel.channel_type == ChannelType.DM:
        # Les DM sont gérés automatiquement
        pass
    
    # Mettre à jour la présence
    presence = OnlinePresence.query.filter_by(user_id=current_user.id).first()
    if presence:
        presence.current_channel = channel_id
        db.session.commit()
    
    # Conversion en string pour garantir la cohérence
    join_room(str(channel_id))
    emit('joined_channel', {'channel_id': channel_id, 'user': current_user.to_dict()})

@socketio.on('game_join')
def handle_game_join(data):
    code = (data or {}).get('code')
    as_spectator = bool((data or {}).get('spectator'))
    if not code:
        return
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code)
        if not session_data:
            emit('game_error', {'code': code, 'error': 'Partie introuvable'})
            return
        if session_data.get('is_private'):
            if session_data.get('creator_id') != current_user.id and session_data.get('invited_username') not in {current_user.username, current_user.display_name}:
                emit('game_error', {'code': code, 'error': 'Accès refusé à cette partie'})
                return
        join_room(f'game_{code}')
        sid_entry = _GAME_SID_INDEX.get(request.sid)
        if not sid_entry:
            sid_entry = {'codes': set()}
            _GAME_SID_INDEX[request.sid] = sid_entry
        sid_entry['codes'].add(code)
        user_id = current_user.id
        username = current_user.display_name or current_user.username
        players = session_data.setdefault('players', {})
        if as_spectator:
            spectators = session_data.setdefault('spectators', {})
            spectators[request.sid] = {'user_id': user_id, 'username': username}
        else:
            if '_bot' in players:
                players.pop('_bot', None)
            pdata = players.get(user_id)
            if not pdata:
                if len([p for p in players.values() if p.get('is_human')]) >= session_data.get('max_players', 2):
                    emit('game_error', {'code': code, 'error': 'Partie complète'})
                    return
                pdata = {
                    'username': username,
                    'role': 'player',
                    'ready': False,
                    'connected_sids': set(),
                    'is_human': True,
                }
                players[user_id] = pdata
            if session_data.get('status') == 'waiting':
                pdata['ready'] = False
            sids = pdata.setdefault('connected_sids', set())
            sids.add(request.sid)
        payload = _serialize_game_session(session_data, current_user_id=current_user.id)
    socketio.emit('game_update', {'game': payload}, room=f'game_{code}')
    emit('game_joined', {'code': code, 'game': payload})
    # Si la partie est en cours et qu'on atteint 2 humains, signaler aux clients PvP
    try:
        with _GAME_SESSIONS_LOCK:
            session_data = _GAME_SESSIONS.get(code)
            if session_data and session_data.get('status') == 'in_progress':
                humans = [p for p in session_data.get('players', {}).values() if p.get('is_human') and p.get('connected_sids')]
                if len(humans) >= 2:
                    socketio.emit('bship_opponent_joined', {'code': code}, room=f'game_{code}')
    except Exception:
        pass

@socketio.on('game_set_ready')
def handle_game_set_ready(data):
    code = (data or {}).get('code')
    ready = bool((data or {}).get('ready'))
    if not code:
        return
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code)
        if not session_data:
            emit('game_error', {'code': code, 'error': 'Partie introuvable'})
            return
        players = session_data.get('players', {})
        pdata = players.get(current_user.id)
        if not pdata or not pdata.get('is_human'):
            emit('game_error', {'code': code, 'error': 'Non joueur'})
            return
        pdata['ready'] = ready
        payload = _serialize_game_session(session_data, current_user_id=current_user.id)
    socketio.emit('game_update', {'game': payload}, room=f'game_{code}')
    # Le démarrage effectif est déclenché séparément par game_start

@socketio.on('game_start')
def handle_game_start(data):
    code = (data or {}).get('code')
    if not code:
        return
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code)
        if not session_data:
            emit('game_error', {'code': code, 'error': 'Partie introuvable'})
            return
        if session_data.get('creator_id') != current_user.id:
            emit('game_error', {'code': code, 'error': 'Seul le créateur peut lancer la partie'})
            return
        if session_data.get('status') != 'waiting':
            return
        players = session_data.get('players', {})
        all_ready = True
        human_count = 0
        for uid, p in players.items():
            if not p.get('is_human'):
                continue
            human_count += 1
            if not p.get('ready'):
                all_ready = False
                break
        if human_count < 1 or not all_ready:
            emit('game_error', {'code': code, 'error': 'Tous les joueurs ne sont pas prêts'})
            return
        session_data['status'] = 'in_progress'
        payload = _serialize_game_session(session_data, current_user_id=current_user.id)
    socketio.emit('game_update', {'game': payload}, room=f'game_{code}')
    socketio.emit('game_started', {'code': code}, room=f'game_{code}')

@socketio.on('game_request_rematch')
def handle_game_request_rematch(data):
    code = (data or {}).get('code')
    if not code:
        return
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code)
        if not session_data:
            emit('game_error', {'code': code, 'error': 'Partie introuvable'})
            return
        players = session_data.get('players', {})
        pdata = players.get(current_user.id)
        if not pdata or not pdata.get('is_human'):
            emit('game_error', {'code': code, 'error': 'Non joueur'})
            return
    socketio.emit('game_rematch_request', {'code': code, 'from_user_id': current_user.id}, room=f'game_{code}')

@socketio.on('game_answer_rematch')
def handle_game_answer_rematch(data):
    code = (data or {}).get('code')
    accept = bool((data or {}).get('accept'))
    if not code:
        return
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code)
        if not session_data:
            emit('game_error', {'code': code, 'error': 'Partie introuvable'})
            return
        if not accept:
            socketio.emit('game_rematch_result', {'code': code, 'accepted': False}, room=f'game_{code}')
            return
        players = session_data.get('players', {})
        for uid, pdata in players.items():
            if not pdata.get('is_human'):
                continue
            pdata['ready'] = False
        session_data['status'] = 'waiting'
        payload = _serialize_game_session(session_data, current_user_id=current_user.id)
    socketio.emit('game_rematch_result', {'code': code, 'accepted': True}, room=f'game_{code}')
    socketio.emit('game_update', {'game': payload}, room=f'game_{code}')

# ============================================
# SOCKET.IO - BRIDGE BATTLESHIP PVP
# ============================================
@socketio.on('bship_fire')
def handle_bship_fire(data):
    code = (data or {}).get('code')
    x = (data or {}).get('x')
    y = (data or {}).get('y')
    if not code or x is None or y is None:
        return
    try:
        socketio.emit('bship_fire', {
            'code': code,
            'from_user_id': current_user.id,
            'x': int(x),
            'y': int(y),
        }, room=f'game_{code}')
    except Exception:
        pass

@socketio.on('bship_result')
def handle_bship_result(data):
    code = (data or {}).get('code')
    x = (data or {}).get('x')
    y = (data or {}).get('y')
    outcome = (data or {}).get('outcome')
    game_over = bool((data or {}).get('game_over'))
    if not code or x is None or y is None or outcome not in {'hit', 'miss'}:
        return
    try:
        socketio.emit('bship_result', {
            'code': code,
            'from_user_id': current_user.id,
            'x': int(x),
            'y': int(y),
            'outcome': outcome,
            'game_over': game_over
        }, room=f'game_{code}')
    except Exception:
        pass

# ============================================
# BATTLESHIP NATIVE SOCKETS
# ============================================
def _bs_new_board():
    return [[{'s': 0} for _ in range(10)] for _ in range(10)]

def _bs_mask_board(board):
    if not isinstance(board, list):
        return board
    masked = [[{'s': 0} for _ in range(10)] for _ in range(10)]
    try:
        for i in range(10):
            for j in range(10):
                v = board[i][j]
                sv = v.get('s') if isinstance(v, dict) else None
                if sv in (2, 3):
                    masked[i][j]['s'] = sv
                else:
                    masked[i][j]['s'] = 0
        return masked
    except Exception:
        return [[{'s': 0} for _ in range(10)] for _ in range(10)]

def _bs_validate_board(board):
    # Vérifie une grille 10x10 composée de 5 navires droits de tailles 5,4,3,3,2
    if not isinstance(board, list) or len(board) != 10:
        return False
    for row in board:
        if not isinstance(row, list) or len(row) != 10:
            return False
    visited = [[False]*10 for _ in range(10)]
    lengths = []
    def inb(x,y): return 0 <= x < 10 and 0 <= y < 10
    for i in range(10):
        for j in range(10):
            cell = board[i][j]
            if not isinstance(cell, dict): 
                return False
            if cell.get('s') != 1 or visited[i][j]:
                continue
            # déterminer l'orientation
            right = inb(i, j+1) and isinstance(board[i][j+1], dict) and board[i][j+1].get('s') == 1
            down  = inb(i+1, j) and isinstance(board[i+1][j], dict) and board[i+1][j].get('s') == 1
            if right and down:
                return False  # forme en L / branchement
            length = 1
            visited[i][j] = True
            if right:
                y = j+1
                while inb(i, y) and isinstance(board[i][y], dict) and board[i][y].get('s') == 1 and not visited[i][y]:
                    # s'assurer qu'on ne dévie pas verticalement
                    if (inb(i+1, y) and isinstance(board[i+1][y], dict) and board[i+1][y].get('s') == 1) or (inb(i-1, y) and isinstance(board[i-1][y], dict) and board[i-1][y].get('s') == 1):
                        return False
                    visited[i][y] = True
                    length += 1
                    y += 1
            elif down:
                x = i+1
                while inb(x, j) and isinstance(board[x][j], dict) and board[x][j].get('s') == 1 and not visited[x][j]:
                    # s'assurer qu'on ne dévie pas horizontalement
                    if (inb(x, j+1) and isinstance(board[x][j+1], dict) and board[x][j+1].get('s') == 1) or (inb(x, j-1) and isinstance(board[x][j-1], dict) and board[x][j-1].get('s') == 1):
                        return False
                    visited[x][j] = True
                    length += 1
                    x += 1
            lengths.append(length)
    lengths.sort()
    return lengths == [2,3,3,4,5]

def _bs_auto_place():
    b = _bs_new_board()
    sizes = [5, 4, 3, 3, 2]
    for size in sizes:
        placed = False
        for _ in range(200):
            horiz = random.random() < 0.5
            x = random.randint(0, 9 if horiz else 9 - size + 1)
            y = random.randint(0, 9 if not horiz else 9 - size + 1)
            ok = True
            for i in range(size):
                xi = x + (i if not horiz else 0)
                yi = y + (i if horiz else 0)
                if b[xi][yi]['s'] != 0:
                    ok = False
                    break
            if not ok:
                continue
            for i in range(size):
                xi = x + (i if not horiz else 0)
                yi = y + (i if horiz else 0)
                b[xi][yi]['s'] = 1
            placed = True
            break
        if not placed:
            return _bs_new_board()
    return b

def _bs_alive(board):
    for i in range(10):
        for j in range(10):
            if board[i][j]['s'] == 1:
                return True
    return False

def _bs_status_label(gs, role):
    if gs.status == 'waiting':
        if role in ('p1', 'p2'):
            my_ready = (role == 'p1' and gs.p1_ready) or (role == 'p2' and gs.p2_ready)
            opp_ready = (role == 'p1' and gs.p2_ready) or (role == 'p2' and gs.p1_ready)
            if not my_ready:
                return 'Place tes bateaux sur ta grille'
            if my_ready and not opp_ready:
                return "En attente de l'adversaire..."
            return 'Préparation terminée'
        return 'Phase de préparation en cours'
    if gs.status == 'in_progress':
        if role in ('p1', 'p2'):
            return 'À TON TOUR !' if gs.current_turn == role else 'Tour adverse'
        return 'Combat en cours'
    if gs.status == 'finished':
        return 'Partie terminée'
    return ''

def _bs_emit_state(gs, room, role=None, extra=None):
    # Masquer la phase de placement aux spectateurs
    p1_board = gs.p1_board
    p2_board = gs.p2_board
    if role == 'spec':
        if gs.status == 'waiting':
            p1_board = None
            p2_board = None
        # en mode spectateur pendant la partie, on montre tout
    else:
        # Pour les joueurs, masquer les navires intacts de l'adversaire
        if role == 'p1':
            p2_board = _bs_mask_board(p2_board) if gs.status == 'in_progress' else p2_board
        elif role == 'p2':
            p1_board = _bs_mask_board(p1_board) if gs.status == 'in_progress' else p1_board
    # Profils joueurs
    p1 = p2 = None
    try:
        from models import User
        if gs.p1_id:
            u1 = db.session.get(User, gs.p1_id)
            if u1:
                p1 = {'id': u1.id, 'username': u1.username, 'display_name': u1.display_name or u1.username, 'avatar': u1.get_avatar_url()}
        if gs.p2_id:
            u2 = db.session.get(User, gs.p2_id)
            if u2:
                p2 = {'id': u2.id, 'username': u2.username, 'display_name': u2.display_name or u2.username, 'avatar': u2.get_avatar_url()}
    except Exception:
        pass
    payload = {
        'code': gs.code,
        'role': role or '',
        'turn': gs.current_turn,
        'turn_id': gs.current_turn_user_id,
        'status': gs.status,
        'status_label': _bs_status_label(gs, role or ''),
        'p1_board': p1_board,
        'p2_board': p2_board,
        'p1': p1,
        'p2': p2,
    }
    if extra:
        payload.update(extra)
    socketio.emit('bs_state', payload, room=room)

def _bs_get_display_identity(current_user_id, p1_id, p2_id):
    try:
        ids = [i for i in [p1_id, p2_id] if i and i != 'bot']
        users_map = {}
        if ids:
            rows = db.session.execute(
                text("SELECT id, username, display_name, photo_url FROM users WHERE id IN :ids"),
                {'ids': tuple(ids)}
            ).mappings().all()
            for r in rows:
                users_map[r['id']] = {
                    'id': r['id'],
                    'username': r.get('username'),
                    'display_name': r.get('display_name') or r.get('username'),
                    'avatar': r.get('photo_url') or '/static/icons/default_avatar.svg'
                }
        from models import User
        for uid in ids:
            if uid not in users_map:
                u = db.session.get(User, uid)
                if u:
                    users_map[uid] = {
                        'id': u.id,
                        'username': u.username,
                        'display_name': u.display_name or u.username,
                        'avatar': u.get_avatar_url()
                    }
        if current_user_id == p1_id:
            left = users_map.get(p1_id)
            right = users_map.get(p2_id) if p2_id != 'bot' else None
        elif current_user_id == p2_id:
            left = users_map.get(p2_id)
            right = users_map.get(p1_id)
        else:
            left = users_map.get(p1_id)
            right = users_map.get(p2_id) if p2_id != 'bot' else None
        return left, right
    except Exception:
        return None, None
@socketio.on('bs_join')
def bs_join(data):
    from models import GameSession
    code = (data or {}).get('code') or ''
    spectator = bool((data or {}).get('spectator'))
    if not code:
        return
    gs = GameSession.query.filter_by(code=code).first()
    if not gs:
        attempts = 0
        while attempts < 5 and not gs:
            attempts += 1
            new_gs = GameSession(
                name='Battleship',
                game_type='battleship',
                is_private=False,
                join_code=code,
                created_by_id=current_user.id,
                max_players=2,
                players_json=[],
                state_json={'phase': 'setup'},
                code=code,
                status='waiting',
                mode='pvp',
                p1_ready=False,
                p2_ready=False
            )
            db.session.add(new_gs)
            try:
                db.session.commit()
                gs = new_gs
            except IntegrityError:
                db.session.rollback()
                gs = GameSession.query.filter_by(code=code).first()
            except Exception:
                db.session.rollback()
                raise
    # Si on rejoint une partie terminée avec ce code, réinitialiser pour une nouvelle manche
    if gs.status == 'finished':
        gs.status = 'waiting'
        gs.p1_ready = False
        gs.p2_ready = False
        gs.current_turn = None
        gs.current_turn_user_id = None
        gs.p1_board = None
        gs.p2_board = None
        gs.history = []
        gs.spectators = []
        if isinstance(gs.state_json, dict):
            gs.state_json['phase'] = 'setup'
        db.session.commit()
    join_room(f'bs_{code}')
    role = 'spec'
    uid = current_user.id
    replaced_bot = False
    if not spectator:
        if not gs.p1_id or gs.p1_id == uid:
            gs.p1_id = uid
            role = 'p1'
        elif not gs.p2_id or gs.p2_id == uid:
            gs.p2_id = uid
            role = 'p2'
            gs.p2_board = None
            gs.p2_ready = False
        else:
            role = 'spec'
        # Démarrage si les deux côtés sont prêts (après phase de placement)
        if gs.status != 'finished' and gs.p1_id and gs.p2_id and gs.p1_ready and gs.p2_ready:
            gs.status = 'in_progress'
            gs.current_turn = 'p1'
            gs.current_turn_user_id = gs.p1_id
        db.session.commit()
    _bs_emit_state(gs, f'bs_{code}', role=role)
    # Émettre identité left/right spécifique au client courant
    left,right = _bs_get_display_identity(uid, gs.p1_id, gs.p2_id)
    try:
        socketio.emit('bs_identity', {'code': code, 'left': left, 'right': right}, room=request.sid)
    except Exception:
        pass

@socketio.on('bs_place')
def bs_place(data):
    from models import GameSession
    code = (data or {}).get('code') or ''
    board = (data or {}).get('board')
    if not code or not isinstance(board, list):
        return
    gs = GameSession.query.filter_by(code=code).first()
    if not gs:
        return
    uid = current_user.id
    if gs.p1_id == uid:
        gs.p1_board = board
    elif gs.p2_id == uid:
        gs.p2_board = board
    db.session.commit()
    _bs_emit_state(gs, f'bs_{code}')

@socketio.on('bs_ready')
def bs_ready(data):
    from models import GameSession
    code = (data or {}).get('code') or ''
    if not code:
        return False
    gs = GameSession.query.filter_by(code=code).first()
    if not gs:
        return False
    uid = current_user.id
    if gs.p1_id == uid:
        # Refuser prêt sans board posé
        if not isinstance(gs.p1_board, list):
            return False
        # Validation stricte: 5 navires droits 5,4,3,3,2
        if not _bs_validate_board(gs.p1_board):
            return False
        gs.p1_ready = True
    elif gs.p2_id == uid:
        if not isinstance(gs.p2_board, list):
            return False
        if not _bs_validate_board(gs.p2_board):
            return False
        gs.p2_ready = True
    else:
        return False
    if gs.p1_ready and gs.p2_ready and gs.status == 'waiting':
        gs.status = 'in_progress'
        gs.current_turn = 'p1'
        gs.current_turn_user_id = gs.p1_id
    db.session.commit()
    _bs_emit_state(gs, f'bs_{code}')
    if gs.status == 'in_progress':
        try:
            socketio.emit('bs_start', {'code': gs.code, 'status': 'in_progress', 'turn_id': gs.current_turn_user_id}, room=f'bs_{code}')
        except Exception:
            pass
    return True

@socketio.on('player_ready')
def player_ready(data):
    code = (data or {}).get('game_id') or (data or {}).get('code') or ''
    fleet = (data or {}).get('fleet_array')
    if not code:
        return
    from models import GameSession
    gs = GameSession.query.filter_by(code=code).first()
    if not gs:
        return
    uid = current_user.id
    # Optionnel: conversion fleet_array -> board 10x10
    board = None
    if isinstance(fleet, list):
        b = [[{'s':0} for _ in range(10)] for _ in range(10)]
        try:
            for ship in fleet:
                coords = ship.get('coords') or []
                for c in coords:
                    x,y = int(c[0]), int(c[1])
                    if 0<=x<10 and 0<=y<10:
                        b[x][y]['s'] = 1
            board = b
        except Exception:
            board = None
    if board:
        if gs.p1_id == uid:
            gs.p1_board = board
        elif gs.p2_id == uid:
            gs.p2_board = board
    ok = bs_ready({'code': code})
    return {'ok': bool(ok)}

@socketio.on('fire')
def fire_alias(data):
    return bs_fire(data)

@socketio.on('ready_status')
def ready_status_alias(data):
    code = (data or {}).get('game_id') or (data or {}).get('code') or ''
    if not code:
        return
    return bs_ready({'code': code})

@socketio.on('fire_shot')
def fire_shot_alias(data):
    return bs_fire(data)

@socketio.on('bs_fire')
def bs_fire(data):
    from models import GameSession
    from flask import request as flask_request
    from sqlalchemy.orm.attributes import flag_modified
    code = (data or {}).get('code') or ''
    x = (data or {}).get('x')
    y = (data or {}).get('y')
    if not code or x is None or y is None:
        return
    gs = GameSession.query.filter_by(code=code).first()
    if not gs or gs.status != 'in_progress':
        return
    uid = current_user.id
    role = None
    if gs.p1_id == uid:
        role = 'p1'
    elif gs.p2_id == uid:
        role = 'p2'
    else:
        return
    # Validation stricte via user_id (évite toute confusion de rôle)
    if gs.current_turn_user_id and gs.current_turn_user_id != uid:
        try:
            room_id = getattr(flask_request, 'sid', None)
            socketio.emit('bs_error', {'message': "Ce n'est pas votre tour"}, room=room_id)
        except Exception:
            pass
        return
    try:
        ox = int(x)
        oy = int(y)
    except Exception:
        try:
            room_id = getattr(flask_request, 'sid', None)
            socketio.emit('bs_error', {'message': "Coordonnées invalides"}, room=room_id)
        except Exception:
            pass
        return
    if not (0 <= ox < 10 and 0 <= oy < 10):
        try:
            room_id = getattr(flask_request, 'sid', None)
            socketio.emit('bs_error', {'message': "Coordonnées hors grille"}, room=room_id)
        except Exception:
            pass
        return
    if not isinstance(gs.p1_board, list) or not isinstance(gs.p2_board, list):
        return
    opp_board = gs.p2_board if role == 'p1' else gs.p1_board
    cell = opp_board[ox][oy]
    if cell.get('s') in (2, 3):
        try:
            room_id = getattr(flask_request, 'sid', None)
            socketio.emit('bs_error', {'message': "Case déjà ciblée"}, room=room_id)
        except Exception:
            pass
        return
    if cell.get('s') == 1:
        cell['s'] = 2
        hit = 'hit'
    else:
        cell['s'] = 3
        hit = 'miss'
    if role == 'p1':
        gs.p2_board = opp_board
        try:
            flag_modified(gs, 'p2_board')
        except Exception:
            pass
    else:
        gs.p1_board = opp_board
        try:
            flag_modified(gs, 'p1_board')
        except Exception:
            pass
    winner = None
    if not _bs_alive(opp_board):
        gs.status = 'finished'
        winner = role
    if gs.status == 'in_progress':
        gs.current_turn = 'p2' if role == 'p1' else 'p1'
        gs.current_turn_user_id = gs.p2_id if role == 'p1' else gs.p1_id
    db.session.commit()
    extra = {'x': ox, 'y': oy, 'hit': hit}
    if winner:
        extra['winner'] = winner
    try:
        socketio.emit(
            'fire_result',
            {
                'code': code,
                'x': ox,
                'y': oy,
                'hit': hit,
                'from': role,
                'winner': winner,
                'turn_id': gs.current_turn_user_id,
            },
            room=f'bs_{code}',
        )
    except Exception:
        pass
    _bs_emit_state(gs, f'bs_{code}', role=role, extra=extra)

@socketio.on('bs_rematch')
def bs_rematch(data):
    from models import GameSession
    code = (data or {}).get('code') or ''
    if not code:
        return
    gs = GameSession.query.filter_by(code=code).first()
    if not gs:
        return
    gs.status = 'waiting'
    gs.p1_ready = False
    gs.p2_ready = False
    gs.current_turn = None
    gs.current_turn_user_id = None
    gs.p1_board = None
    gs.p2_board = None
    db.session.commit()
    _bs_emit_state(gs, f'bs_{code}')

@socketio.on('bs_chat')
def bs_chat(data):
    code = (data or {}).get('code') or ''
    msg = (data or {}).get('message') or ''
    if not code or not msg:
        return
    from models import GameSession, User
    gs = GameSession.query.filter_by(code=code).first()
    if not gs:
        return
    uid = current_user.id
    role = None
    if gs.p1_id == uid:
        role = 'p1'
    elif gs.p2_id == uid:
        role = 'p2'
    else:
        # Spectateurs: lecture seule
        return
    user = db.session.get(User, uid)
    user_payload = None
    if user:
        user_payload = {'id': user.id, 'username': user.username, 'display_name': user.display_name or user.username, 'avatar': user.get_avatar_url()}
    payload = {'code': code, 'from': role, 'user': user_payload, 'message': msg[:300]}
    socketio.emit('bs_chat', payload, room=f'bs_{code}')

@socketio.on('leave_channel')
def handle_leave_channel(data):
    """Quitte un salon"""
    channel_id = data.get('channel_id')
    if channel_id:
        # CORRECTION CRITIQUE : Utiliser str(channel_id)
        leave_room(str(channel_id))
        
        presence = OnlinePresence.query.filter_by(user_id=current_user.id).first()
        if presence and presence.current_channel == channel_id:
            presence.current_channel = None
            db.session.commit()

@socketio.on('send_message')
def handle_send_message(data):
    """Envoi d'un message"""
    try:
        print(f"[DEBUG] handle_send_message called with data: {data}")
        channel_id = data.get('channel_id')
        content = data.get('content', '').strip()
        reply_to_id = data.get('reply_to_id')
        attachments_data = data.get('attachments', [])
        dm_target_user_id = data.get('dm_target_user_id')
        client_id = data.get('client_id')  # Pour le suivi Optimistic UI
        
        if not content:
            print("[DEBUG] Content missing")
            return {'status': 'error', 'message': 'Données invalides'}
        
        if not channel_id and dm_target_user_id:
            print(f"[DEBUG] Creating DM for target {dm_target_user_id}")
            target_user = db.session.get(User, dm_target_user_id)
            if not target_user or not target_user.is_active:
                return {'status': 'error', 'message': 'Utilisateur cible invalide'}
            dm_channel = _find_dm_channel(current_user.id, dm_target_user_id)
            if not dm_channel:
                dm_channel = Channel(
                    name=f"DM-{current_user.username}-{target_user.username}",
                    description=None,
                    channel_type=ChannelType.DM,
                    category="Privé"
                )
                db.session.add(dm_channel)
                db.session.commit()
                p1 = ChannelParticipant(channel_id=dm_channel.id, user_id=current_user.id)
                p2 = ChannelParticipant(channel_id=dm_channel.id, user_id=target_user.id)
                db.session.add(p1)
                db.session.add(p2)
                db.session.commit()
                join_room(str(dm_channel.id))
                emit('dm_conversation_created', {
                    'channel': dm_channel.to_dict(),
                    'other_user': current_user.to_dict(include_sensitive=False),
                }, room=f"user_{target_user.id}")
            channel_id = dm_channel.id
        
        if not channel_id:
            print("[DEBUG] Channel ID missing")
            return {'status': 'error', 'message': 'Données invalides'}
        
        channel = db.session.get(Channel, channel_id)
        if not channel:
            print(f"[DEBUG] Channel {channel_id} not found")
            return {'status': 'error', 'message': 'Salon non trouvé'}
        
        # Vérifier si l'utilisateur peut écrire dans ce salon
        if not current_user.is_authenticated:
            print("[DEBUG] User not authenticated")
            return {'status': 'error', 'message': 'Vous devez être connecté'}
        
        if not current_user.is_active:
            print("[DEBUG] User not active")
            return {'status': 'error', 'message': 'Votre compte est désactivé'}
        
        # Le salon #admin est réservé aux admins
        if channel.name == 'admin' and not current_user.is_admin:
            return {'status': 'error', 'message': 'Seuls les administrateurs peuvent écrire dans ce salon'}
        
        if channel.is_read_only and not current_user.is_admin:
            return {'status': 'error', 'message': 'Ce salon est en lecture seule'}
        
        mute_until_obj = getattr(current_user, 'mute_until', None)
        if isinstance(mute_until_obj, datetime):
            try:
                now_ts = time.time()
                mute_until_ts = mute_until_obj.timestamp()
                if mute_until_ts > now_ts:
                    mute_until_int = int(mute_until_ts)
                    _ANTISPAM_MUTES[current_user.id] = mute_until_int
                    socketio.emit('mute_state', {'mute_until': mute_until_int}, room=f"user_{current_user.id}")
                    return {'status': 'error', 'message': 'Vous êtes actuellement mute'}
            except Exception:
                pass
        
        if not current_user.is_admin:
            reason = _check_antispam(current_user.id, content)
            if reason:
                try:
                    now_ts = time.time()
                    mute_until = _ANTISPAM_MUTES.get(current_user.id, 0)
                    remaining = int(max(0, mute_until - now_ts))
                    if reason in ("spam_burst", "spam_soutenu", "spam_duplicatif", "mute_actif", "spam_persec", "spam_liens", "spam_chars"):
                        if reason == "spam_burst":
                            _delete_recent_messages_of_user(current_user.id, ANTISPAM_BURST_WINDOW)
                        elif reason == "spam_soutenu":
                            _delete_recent_messages_of_user(current_user.id, ANTISPAM_SUSTAINED_WINDOW)
                        elif reason == "spam_duplicatif":
                            _delete_recent_messages_of_user(current_user.id, ANTISPAM_DUP_SERIES_WINDOW)
                        elif reason == "spam_persec":
                            _delete_recent_messages_of_user(current_user.id, ANTISPAM_PERSEC_WINDOW)
                        elif reason == "spam_liens":
                            _delete_recent_messages_of_user(current_user.id, ANTISPAM_BURST_WINDOW)
                        elif reason == "spam_chars":
                            _delete_recent_messages_of_user(current_user.id, ANTISPAM_BURST_WINDOW)
                        socketio.emit('mute_state', {'mute_until': int(mute_until)}, room=f"user_{current_user.id}")
                        emit('anti_spam_muted', {'seconds': remaining or ANTISPAM_MUTE_SECONDS, 'mute_until': int(mute_until)}, room=request.sid)
                        return {'status': 'error', 'message': 'Anti-spam: mute actif'}
                    else:
                        emit('anti_spam_warning', {'reason': reason}, room=request.sid)
                        return {'status': 'error', 'message': 'Anti-spam: ' + reason}
                except Exception as e:
                    print(f"[ANTISPAM] Error notifying client: {e}")
                    return {'status': 'error', 'message': 'Anti-spam'}
        
        # ROBUSTESSE : Rejoindre le salon pour être sûr de recevoir les événements
        # Cela corrige le bug où l'utilisateur n'est pas dans la room s'il n'a pas fait join_channel explicitement
        # Conversion en string pour garantir la cohérence
        join_room(str(channel_id))
        print(f"[DEBUG] User {current_user.username} forced joined room {channel_id}")
        
        # =================================================================
        # SHADOWBAN : Filtrage des messages
        # =================================================================
        # Un utilisateur shadowbanni voit ses messages normalement,
        # mais personne d'autre ne les voit (sauf les admins)
        
        is_shadowbanned = current_user.is_shadowbanned
        
        # Créer le message
        message = Message(
            channel_id=channel_id,
            user_id=current_user.id,
            content=content,
            reply_to_id=reply_to_id
        )
        
        db.session.add(message)
        db.session.commit()
        
        # Associer les fichiers au message
        if attachments_data:
            for att_data in attachments_data:
                file_id = att_data.get('id')
                if file_id:
                    # Mettre à jour le message_id du fichier
                    file_record = FileAttachment.query.get(file_id)
                    if file_record:
                        file_record.message_id = message.id
                        db.session.add(file_record)
            
            db.session.commit()
        
        # Rafraîchir le message pour s'assurer que les relations sont à jour
        db.session.refresh(message)
        
        message_dict = message.to_dict()
        try:
            mentioned_ids = []
            if content and '@' in content:
                mentioned_usernames = set([m.lstrip('@') for m in re.findall(r'@(\w+)', content)])
                if mentioned_usernames:
                    users_mentioned = User.query.filter(User.username.in_(mentioned_usernames)).all()
                    mentioned_ids = [u.id for u in users_mentioned if u and u.id]
            if mentioned_ids:
                message_dict['mentioned_user_ids'] = mentioned_ids
        except Exception as e:
            print(f"[DEBUG] Mention parsing error: {e}")
        if client_id:
            message_dict['client_id'] = client_id
        
        # Marquer comme lu par l'expéditeur
        read_receipt = MessageRead(
            message_id=message.id,
            user_id=current_user.id
        )
        db.session.add(read_receipt)
        db.session.commit()
        
        if is_shadowbanned:
            # =================================================================
            # CAS SHADOWBAN : Le message n'est visible que par l'expéditeur
            # =================================================================
            # 1. Envoyer le message UNIQUEMENT à l'expéditeur
            emit('new_message', message_dict, room=request.sid)
            
            # 2. NOTIFIER LES ADMINS en secret (pour qu'ils sachent que la personne parle)
            admins = User.query.filter(User.role.in_([UserRole.ADMIN, UserRole.SUPREME])).all()
            for admin in admins:
                if admin.id != current_user.id:  # Ne pas notifier l'admin s'il est shadowbanni
                    admin_presence = OnlinePresence.query.filter_by(user_id=admin.id).first()
                    if admin_presence:
                        emit('shadowbanned_message', {
                            'message': message_dict,
                            'shadowbanned_user': current_user.to_dict()
                        }, room=admin_presence.socket_id)
            
            # Log pour audit
            log_action(current_user, 'SHADOWBAN_MESSAGE', target_id=message.id,
                       target_type='message', details=f'Message shadowbanni dans #{channel.name}')
        else:
            socketio.emit('new_message', message_dict, room=str(channel_id))
            if channel.channel_type != ChannelType.DM:
                broadcast_channel_activity(channel_id)
            
            # Mettre à jour la liste des conversations privées pour les participants
            if channel.channel_type == ChannelType.DM:
                participants = ChannelParticipant.query.filter_by(channel_id=channel_id).all()
                for p in participants:
                    user = db.session.get(User, p.user_id)
                    if user:
                        other_user = None
                        if user.id != current_user.id:
                            other_user = current_user.to_dict(include_sensitive=False)
                        else:
                            other_user_id = next((pp.user_id for pp in participants if pp.user_id != user.id), None)
                            if other_user_id:
                                other = db.session.get(User, other_user_id)
                                if other:
                                    other_user = other.to_dict(include_sensitive=False)
                        emit('dm_conversation_updated', {
                            'channel': channel.to_dict(),
                            'other_user': other_user,
                            'last_message': message_dict
                        }, room=f"user_{user.id}")
            
            # =================================================================
            # ÉVÉNEMENT TEMPS RÉEL POUR L'HISTORIQUE DES FICHIERS
            # =================================================================
            # Si le message contient des fichiers, notifier tous les abonnés
            if attachments_data:
                # Récupérer les fichiers qui viennent d'être associés au message
                uploaded_files = []
                for att_data in attachments_data:
                    file_id = att_data.get('id')
                    if file_id:
                        file_record = FileAttachment.query.get(file_id)
                        if file_record:
                            uploaded_files.append(file_record.to_dict())
                
                if uploaded_files:
                    # Émettre l'événement aux membres du salon uniquement (Correction pour éviter les fuites)
                    # CORRECTION CRITIQUE : Utiliser str(channel_id)
                    emit('new_file_uploaded', {
                        'files': uploaded_files,
                        'channel_id': channel_id,
                        'channel_name': channel.name
                    }, room=str(channel_id))
                    
                    print(f"[SocketIO] Événement new_file_uploaded envoyé au salon {channel.name} ({channel_id})")
        
        # Retourner les données pour l'ACK client (Optimistic UI)
        return {'status': 'ok', 'data': message_dict}
            
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in handle_send_message: {str(e)}")
        print(traceback.format_exc())
        return {'status': 'error', 'message': f'Erreur serveur: {str(e)}'}

@socketio.on('edit_message')
def handle_edit_message(data):
    """
    Édite un message existant (corrige le bug d'édition)
    Avant : Créait un nouveau message (INSERT)
    Après : Met à jour le message existant (UPDATE)
    """
    message_id = data.get('message_id')
    new_content = data.get('content', '').strip()
    
    if not message_id or not new_content:
        emit('error', {'message': 'Données invalides pour l\'édition'})
        return
    
    # Récupérer le message
    print(f"[DEBUG] Tentative d'édition du message: {message_id} par l'utilisateur: {current_user.id}")
    message = Message.query.get(message_id)
    if not message:
        print(f"[ERROR] Message non trouvé: {message_id}")
        emit('error', {'message': 'Message non trouvé'})
        return
    
    print(f"[DEBUG] Message trouvé. Auteur: {message.user_id}, Canal: {message.channel_id}")
    
    # Vérifier les permissions
    if message.user_id != current_user.id and not current_user.is_admin:
        emit('error', {'message': 'Permission refusée'})
        return
    
    # Vérifier que le message n'est pas déjà supprimé
    if message.is_deleted:
        emit('error', {'message': 'Ce message a été supprimé'})
        return
    
    # Stocker l'ancien contenu pour l'historique
    old_content = message.content
    
    # Mettre à jour le message
    message.content = new_content
    message.is_edited = True
    message.edited_at = datetime.now(timezone.utc)
    
    db.session.commit()
    
    # =================================================================
    # Logique Shadowban pour l'édition
    # =================================================================
    user = db.session.get(User, message.user_id)
    
    if user and user.is_shadowbanned:
        # L'édition n'est visible que par l'auteur (et les admins en secret)
        emit('message_edited', message.to_dict(), room=request.sid)
        
        #Notifier les admins
        admins = User.query.filter(User.role.in_([UserRole.ADMIN, UserRole.SUPREME])).all()
        for admin in admins:
            if admin.id != user.id:
                admin_presence = OnlinePresence.query.filter_by(user_id=admin.id).first()
                if admin_presence:
                    emit('shadowbanned_edited', {
                        'message': message.to_dict(),
                        'shadowbanned_user': user.to_dict()
                    }, room=admin_presence.socket_id)
    else:
        # Édition visible par tous
        # CORRECTION CRITIQUE : Utiliser str(channel_id)
        socketio.emit('message_edited', message.to_dict(), room=str(message.channel_id))
    
    # Log de l'édition
    log_action(current_user, ActionType.EDIT_MESSAGE, target_id=message_id,
               target_type='message', details=f'Édition de message dans #{(db.session.get(Channel, message.channel_id).name if db.session.get(Channel, message.channel_id) else "inconnu")}')

@socketio.on('admin_action')
def handle_admin_action(data):
    """
    Gère les actions d'administration via Socket.IO
    Actions supportées : kick, ban, unban, shadowban, promote, demote
    """
    if not current_user.is_admin:
        emit('error', {'message': 'Droits administrateur requis'})
        return
    
    action = data.get('action')
    target_user_id = data.get('user_id')
    extra_data = data.get('data', {})  # Pour les données supplémentaires (ex: redirect_url pour kick)
    
    if not action or not target_user_id:
        emit('error', {'message': 'Données invalides'})
        return
    
    # Ne pas permettre de s'auto-administrer
    if target_user_id == current_user.id:
        emit('error', {'message': 'Vous ne pouvez pas effectuer cette action sur vous-même'})
        return
    
    target_user = db.session.get(User, target_user_id)
    if not target_user:
        emit('error', {'message': 'Utilisateur non trouvé'})
        return
    
    # Empêcher de toucher à l'Admin Suprême (sauf si on est Admin Suprême)
    if target_user.is_supreme and not current_user.is_supreme:
        emit('error', {'message': 'Impossible d\'effectuer cette action sur l\'Admin Suprême'})
        return
    
    # =================================================================
    # KICK : Expulsion avec redirection optionnelle
    # =================================================================
    if action == 'kick':
        redirect_url = extra_data.get('redirect_url')
        reason = extra_data.get('reason', 'Vous avez été expulsé')
        
        # Déconnecter via Socket.IO
        presence = OnlinePresence.query.filter_by(user_id=target_user_id).first()
        if presence:
            kick_data = {
                'reason': reason,
                'kicked_by': current_user.to_dict()
            }
            
            # Si une URL de redirection est fournie, l'inclure
            if redirect_url:
                kick_data['redirect_url'] = redirect_url
            
            emit('kicked', kick_data, room=presence.socket_id)
            safe_disconnect(presence.socket_id)
        
        log_action(current_user, ActionType.KICK, target_id=target_user_id,
                   target_type='user', details=f'Expulsion de @{target_user.username}' + (f' vers {redirect_url}' if redirect_url else ''))
        
        emit('admin_action_complete', {
            'action': 'kick',
            'success': True,
            'target_user': target_user.to_dict(),
            'message': f'@{target_user.username} a été expulsé'
        })
    
    # =================================================================
    # BAN : Bannissement simple
    # =================================================================
    elif action == 'ban':
        target_user.is_active = False
        db.session.commit()
        
        # Déconnecter l'utilisateur
        presence = OnlinePresence.query.filter_by(user_id=target_user_id).first()
        if presence:
            emit('banned', {
                'reason': extra_data.get('reason', 'Vous avez été banni'),
                'banned_by': current_user.to_dict()
            }, room=presence.socket_id)
            safe_disconnect(presence.socket_id)
        
        log_action(current_user, ActionType.BAN_USER, target_id=target_user_id,
                   target_type='user', details=f'Bannissement de @{target_user.username}')
        
        emit('admin_action_complete', {
            'action': 'ban',
            'success': True,
            'target_user': target_user.to_dict(),
            'message': f'@{target_user.username} a été banni'
        })
    
    # =================================================================
    # UNBAN : Débannissement
    # =================================================================
    elif action == 'unban':
        # Réactiver l'utilisateur ET lever le shadowban s'il était actif
        target_user.is_active = True
        was_shadowbanned = target_user.is_shadowbanned
        target_user.is_shadowbanned = False  # Lever le shadowban lors du déban
        db.session.commit()
        
        log_action(current_user, ActionType.UNBAN_USER, target_id=target_user_id,
                   target_type='user', details=f'Débannissement de @{target_user.username}' + (' (shadowban levé)' if was_shadowbanned else ''))
        
        emit('admin_action_complete', {
            'action': 'unban',
            'success': True,
            'target_user': target_user.to_dict(),
            'message': f'@{target_user.username} a été rétabli' + (' (shadowban levé)' if was_shadowbanned else '')
        })
    
    # =================================================================
    # SHADOWBAN : Bannissement invisible
    # =================================================================
    elif action == 'shadowban':
        # Toggle shadowban
        target_user.is_shadowbanned = not target_user.is_shadowbanned
        db.session.commit()
        
        new_state = 'shadowbanné' if target_user.is_shadowbanned else 'dé-shadowbanné'
        
        log_action(current_user, 'SHADOWBAN', target_id=target_user_id,
                   target_type='user', details=f'{new_state} @{target_user.username}')
        
        emit('admin_action_complete', {
            'action': 'shadowban',
            'success': True,
            'target_user': target_user.to_dict(),
            'is_shadowbanned': target_user.is_shadowbanned,
            'message': f'@{target_user.username} a été {new_state}'
        })
    
    # =================================================================
    # PROMOTE : Promotion
    # =================================================================
    elif action == 'promote':
        new_role = extra_data.get('role', UserRole.MODERATOR)
        
        if not current_user.is_supreme:
            # Les admins normaux ne peuvent promouvoir qu'au rang modérateur
            if target_user.role in [UserRole.ADMIN, UserRole.SUPREME]:
                emit('error', {'message': 'Permissions insuffisantes pour cette promotion'})
                return
            new_role = UserRole.MODERATOR
        
        if new_role not in [UserRole.ADMIN, UserRole.MODERATOR]:
            emit('error', {'message': 'Rôle invalide'})
            return
        
        target_user.role = new_role
        db.session.commit()
        
        log_action(current_user, ActionType.PROMOTE, target_id=target_user_id,
                   target_type='user', details=f'@{target_user.username} promu {new_role}')
        
        emit('admin_action_complete', {
            'action': 'promote',
            'success': True,
            'target_user': target_user.to_dict(),
            'message': f'@{target_user.username} est maintenant {new_role}'
        })
    
    # =================================================================
    # DEMOTE : Rétrogradation
    # =================================================================
    elif action == 'demote':
        if target_user.is_supreme:
            emit('error', {'message': 'Impossible de rétrograder l\'Admin Suprême'})
            return
        
        target_user.role = UserRole.MEMBER
        db.session.commit()
        
        log_action(current_user, ActionType.DEMOTE, target_id=target_user_id,
                   target_type='user', details=f'Rétrogradation de @{target_user.username}')
        
        emit('admin_action_complete', {
            'action': 'demote',
            'success': True,
            'target_user': target_user.to_dict(),
            'message': f'@{target_user.username} est maintenant membre'
        })
    
    # =================================================================
    # TROLL : Action humoristique (Étape 8)
    # =================================================================
    elif action == 'troll':
        presence = OnlinePresence.query.filter_by(user_id=target_user_id).first()
        if presence:
            messages = [
                "Ton écran va s'auto-détruire dans 5 secondes...",
                "Erreur 418: I'm a teapot",
                "Félicitations, vous venez de gagner un abonnement gratuit à KRONOS PREMIUM ! (C'est faux)",
                "Un canard géant vient de voler tes cookies de session.",
                "System.exit(0) ... Ah non, j'ai pas le droit.",
                "Tu as été sélectionné pour tester la nouvelle interface INVISIBLE !"
            ]
            import random
            emit('trolled', {
                'message': random.choice(messages),
                'trolled_by': current_user.display_name or current_user.username
            }, room=presence.socket_id)
            
            log_action(current_user, 'TROLL', target_id=target_user_id,
                       target_type='user', details=f'Troll sur @{target_user.username}')
            
            emit('admin_action_complete', {
                'action': 'troll',
                'success': True,
                'target_user': target_user.to_dict(),
                'message': f'@{target_user.username} a été trollé avec succès'
            })
    
    # =================================================================
    # UNADMIN : Rétrogradation d'admin à membre
    # =================================================================
    elif action == 'unadmin':
        if target_user.is_supreme:
            emit('error', {'message': 'Impossible de rétrograder l\'Admin Suprême'})
            return
        
        if target_user.role not in [UserRole.ADMIN, UserRole.MODERATOR]:
            emit('error', {'message': 'Cet utilisateur n\'est pas administrateur'})
            return
        
        target_user.role = UserRole.MEMBER
        db.session.commit()
        
        log_action(current_user, ActionType.DEMOTE, target_id=target_user_id,
                   target_type='user', details=f'@{target_user.username} n\'est plus admin')
        
        emit('admin_action_complete', {
            'action': 'unadmin',
            'success': True,
            'target_user': target_user.to_dict(),
            'message': f'@{target_user.username} n\'est plus administrateur'
        })
    
    else:
        emit('error', {'message': f'Action inconnue: {action}'})

@socketio.on('typing')
def handle_typing(data):
    """Indicateur de frappe"""
    channel_id = data.get('channel_id')
    is_typing = data.get('typing', True)
    
    presence = OnlinePresence.query.filter_by(user_id=current_user.id).first()
    if presence:
        presence.is_typing = is_typing
        presence.typing_channel = channel_id if is_typing else None
        presence.last_ping = datetime.now(timezone.utc)
        db.session.commit()
    
    # Émettre aux autres utilisateurs du salon
    emit('user_typing', {
        'user_id': current_user.id,
        'username': current_user.username,
        'display_name': current_user.display_name or current_user.username,
        'channel_id': channel_id,
        'is_typing': is_typing
    }, room=str(channel_id), skip_sid=request.sid)

@socketio.on('mark_read')
def handle_mark_read(data):
    """Marquer un message comme lu"""
    message_id = data.get('message_id')
    
    if not message_id:
        return
    
    # Vérifier si déjà marqué comme lu
    existing = MessageRead.query.filter_by(
        message_id=message_id,
        user_id=current_user.id
    ).first()
    
    if existing:
        return
    
    read_receipt = MessageRead(
        message_id=message_id,
        user_id=current_user.id
    )
    db.session.add(read_receipt)
    db.session.commit()
    
    # Notifier l'auteur du message
    message = Message.query.get(message_id)
    if message:
        emit('message_read', {
            'message_id': message_id,
            'reader_id': current_user.id,
            'reader_name': current_user.display_name or current_user.username
        }, room=f"user_{message.user_id}")

@socketio.on('get_members')
def handle_get_members(data):
    """
    Récupère la liste des membres (en ligne/hors ligne)
    Inclut une liste séparée pour les utilisateurs bannis/shadowbannis
    Note: Un utilisateur shadowbanni ne se voit PAS dans la liste des bannis,
    mais les autres utilisateurs VOIENT qu'il est banni
    """
    try:
        all_users = User.query.all()
        online_presences = OnlinePresence.query.filter(
            OnlinePresence.last_ping > datetime.now(timezone.utc) - timedelta(minutes=5)
        ).all()
        online_user_ids = {p.user_id for p in online_presences}
        members = []
        banned_list = []
        shadowbanned_list = []
        for user in all_users:
            if user.is_active:
                user_data = user.to_dict()
                user_data['is_online'] = user.id in online_user_ids
                user_data['last_seen'] = user.last_seen.isoformat() if user.last_seen else None
                if user.is_shadowbanned:
                    members.append(user_data)
                    shadowbanned_entry = user.to_dict()
                    shadowbanned_entry['is_online'] = user.id in online_user_ids
                    shadowbanned_entry['last_seen'] = user.last_seen.isoformat() if user.last_seen else None
                    shadowbanned_list.append(shadowbanned_entry)
                else:
                    members.append(user_data)
            else:
                user_data = user.to_dict()
                user_data['is_online'] = user.id in online_user_ids
                user_data['last_seen'] = user.last_seen.isoformat() if user.last_seen else None
                banned_list.append(user_data)
        if current_user.is_shadowbanned:
            visible_banned = [b for b in banned_list if not b.get('is_shadowbanned', False)]
            visible_shadowbanned = []
        else:
            visible_banned = banned_list
            visible_shadowbanned = shadowbanned_list
        emit('members_list', {
            'members': members,
            'banned': visible_banned,
            'shadowbanned': visible_shadowbanned,
            'total_online': len(online_user_ids),
            'online_user_ids': list(online_user_ids)
        })
    except OperationalError as e:
        print(f"[DB OPERATIONAL ERROR][get_members] {e}")


@socketio.on('get_admin_users')
def handle_get_admin_users(data):
    """
    Récupère la liste complète des utilisateurs pour les admins
    Inclut les utilisateurs shadowbannis et bannis
    """
    if not current_user.is_admin:
        emit('error', {'message': 'Droits administrateur requis'})
        return
    try:
        all_users = User.query.all()
        online_presences = OnlinePresence.query.filter(
            OnlinePresence.last_ping > datetime.now(timezone.utc) - timedelta(minutes=5)
        ).all()
        online_user_ids = {p.user_id for p in online_presences}
        users_data = []
        for user in all_users:
            user_data = user.to_dict(include_sensitive=True)
            user_data['is_online'] = user.id in online_user_ids
            users_data.append(user_data)
        emit('admin_users_list', {
            'users': users_data,
            'total': len(users_data)
        })
    except OperationalError as e:
        print(f"[DB OPERATIONAL ERROR][get_admin_users] {e}")

@socketio.on('check_admin_access')
def handle_check_admin_access(data):
    """
    Vérifie si l'utilisateur a accès au salon admin
    Et retourne les permissions actuelles
    """
    emit('admin_access_result', {
        'is_admin': current_user.is_admin,
        'is_supreme': current_user.is_supreme,
        'can_access_admin_channel': current_user.is_admin,
        'role': current_user.role
    })

# ============================================
# WebRTC SIGNALISATION
# ============================================
@socketio.on('webrtc_offer')
def handle_webrtc_offer(data):
    """Reçoit une offre WebRTC et l'envoie au destinataire"""
    target_user_id = data.get('target_user_id')
    offer = data.get('offer')
    
    if target_user_id:
        emit('webrtc_offer', {
            'offer': offer,
            'from_user_id': current_user.id,
            'from_user_name': current_user.display_name or current_user.username
        }, room=f"user_{target_user_id}")

@socketio.on('webrtc_answer')
def handle_webrtc_answer(data):
    """Reçoit une réponse WebRTC"""
    target_user_id = data.get('target_user_id')
    answer = data.get('answer')
    
    if target_user_id:
        emit('webrtc_answer', {
            'answer': answer,
            'from_user_id': current_user.id
        }, room=f"user_{target_user_id}")

@socketio.on('webrtc_ice_candidate')
def handle_webrtc_ice_candidate(data):
    """Échange des candidats ICE"""
    target_user_id = data.get('target_user_id')
    candidate = data.get('candidate')
    
    if target_user_id:
        emit('webrtc_ice_candidate', {
            'candidate': candidate,
            'from_user_id': current_user.id
        }, room=f"user_{target_user_id}")

@socketio.on('webrtc_join_voice')
def handle_join_voice(data):
    """Rejoint un salon vocal"""
    channel_id = data.get('channel_id')
    join_room(f"voice_{channel_id}")
    
    emit('user_joined_voice', {
        'user_id': current_user.id,
        'user_name': current_user.display_name or current_user.username
    }, room=f"voice_{channel_id}")

@socketio.on('webrtc_leave_voice')
def handle_leave_voice(data):
    """Quitte un salon vocal"""
    channel_id = data.get('channel_id')
    leave_room(f"voice_{channel_id}")
    
    emit('user_left_voice', {
        'user_id': current_user.id
    }, room=f"voice_{channel_id}")

# ============================================
# ROUTES PANIC MODE
# ============================================
@app.route('/api/panic/config', methods=['GET'])
@login_required
def get_panic_config():
    """Récupère la config du Panic Mode (personnelle si définie, sinon globale)"""
    # Priorité à la config personnelle de l'utilisateur
    if current_user.personal_panic_url:
        return jsonify({
            'panic_url': current_user.personal_panic_url,
            'panic_hotkey': current_user.personal_panic_hotkey or PANIC_HOTKEY,
            'is_personal': True
        })
    
    # Sinon, retourner la config globale
    return jsonify({
        'panic_url': PANIC_REDIRECT_URL,
        'panic_hotkey': PANIC_HOTKEY,
        'is_personal': False
    })

@app.route('/api/panic/config', methods=['POST'])
@login_required
def update_panic_config():
    """
    Met à jour la config personnelle du Panic Mode
    TOUS les utilisateurs peuvent définir leur propre URL de redirection
    """
    data = request.get_json()
    
    new_hotkey = data.get('panic_hotkey')
    new_url = data.get('panic_url')
    
    # Sauvegarder dans les préférences personnelles de l'utilisateur
    if new_url is not None:
        current_user.personal_panic_url = new_url if new_url.strip() else None
    
    if new_hotkey:
        current_user.personal_panic_hotkey = new_hotkey
    
    db.session.commit()
    
    log_action(current_user, 'UPDATE_PANIC_CONFIG', 
               target_type='user', 
               details=f'Panic personnel mis à jour: url={new_url}, hotkey={new_hotkey}')
    
    return jsonify({
        'message': 'Configuration Panic personnelle mise à jour',
        'panic_hotkey': current_user.personal_panic_hotkey or PANIC_HOTKEY,
        'panic_url': current_user.personal_panic_url or PANIC_REDIRECT_URL,
        'is_personal': bool(current_user.personal_panic_url)
    })

@app.route('/api/system/info', methods=['GET'])
@login_required
def get_system_info():
    """Récupère les informations système (IP serveur, permissions)"""
    # Vérifier si l'utilisateur est Admin Supreme (IP matching)
    client_ip = get_client_ip()
    is_supreme = is_supreme_admin(ip=client_ip)
    
    # IPs locales possibles
    local_ips = ['127.0.0.1', 'localhost', '::1']
    
    return jsonify({
        'user_ip': client_ip,
        'is_local_ip': client_ip in local_ips,
        'is_supreme_admin': is_supreme or current_user.is_supreme,
        'is_admin': current_user.is_admin,
        'role': current_user.role,
        'server_time': datetime.now(timezone.utc).isoformat()
    })

@app.route('/api/panic/trigger', methods=['POST'])
@login_required
def trigger_panic():
    """
    Déclenche le Panic Mode
    Utilise l'URL personnelle si définie, sinon l'URL globale
    """
    # Utiliser l'URL personnelle si définie, sinon l'URL globale
    redirect_url = current_user.personal_panic_url if current_user.personal_panic_url else PANIC_REDIRECT_URL
    
    # Log l'action pour audit
    log_action(current_user, 'PANIC_TRIGGER', target_id=current_user.id,
               target_type='user', 
               details=f'Déclenchement du Panic Mode vers: {redirect_url}')
    
    return jsonify({
        'message': 'Panic Mode activé',
        'redirect_url': redirect_url
    })

# ============================================
# ROUTES PRINCIPALES
# ============================================
@app.route('/')
def index():
    """Page principale - SPA"""
    try:
        user_theme = current_user.theme if current_user.is_authenticated else 'dark'
    except Exception:
        user_theme = 'dark'
    return render_template('index.html', theme=user_theme)

@app.route('/login')
def login_page():
    """Page de connexion"""
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    return render_template('login.html', theme=THEME)

@app.route('/forgot-password')
def forgot_password_page():
    """Page de récupération de mot de passe"""
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    return render_template('forgot_password.html', theme=THEME)

@app.route('/register')
def register_page():
    """Page d'inscription"""
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    return render_template('register.html', theme=THEME)

@app.route('/terms')
def terms_page():
    """Page des conditions d'utilisation - Version troll"""
    return """
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Conditions d'utilisation - KRONOS</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Courier New', monospace;
                background: #0a0a0c;
                color: #e4e4e7;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                max-width: 600px;
                text-align: center;
                animation: fadeIn 0.5s ease;
            }
            h1 {
                color: #ccff00;
                font-size: 2rem;
                margin-bottom: 30px;
                text-transform: uppercase;
                letter-spacing: 3px;
            }
            .message {
                background: #1e1e24;
                border: 2px solid #3f3f46;
                padding: 30px;
                border-radius: 4px;
                margin-bottom: 20px;
            }
            .message p {
                font-size: 1.1rem;
                line-height: 1.8;
                margin-bottom: 15px;
            }
            .highlight {
                color: #ccff00;
                font-weight: bold;
            }
            .countdown {
                font-size: 3rem;
                color: #ff2a2a;
                margin: 30px 0;
                font-weight: bold;
            }
            .footer {
                color: #52525b;
                font-size: 0.8rem;
                margin-top: 30px;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Conditions d'utilisation</h1>
            <div class="message">
                <p>Eh bien, vous avez cliqué sur le lien des conditions d'utilisation...</p>
                <p>Félicitations ! Vous venez de perdre <span class="highlight">3 secondes</span> de votre vie que vous ne récupérerez jamais.</p>
                <p>En réalité, on n'a pas eu le temps d'écrire des conditions d'utilisation.</p>
                <p>Donc en gros : <span class="highlight">soyez cools, pas de spam, pas de spam, et surtout... pas de spam.</span></p>
                <p>C'est à peu près tout.</p>
            </div>
            <p>Redirection dans <span class="highlight" id="countdown">5</span> secondes...</p>
            <div class="countdown" id="timer">5</div>
            <div class="footer">
                © KRONOS - De toute façon, personne ne lit ça.
            </div>
        </div>
        <script>
            let count = 5;
            const timer = document.getElementById('timer');
            const countdown = document.getElementById('countdown');
            
            const interval = setInterval(() => {
                count--;
                timer.textContent = count;
                countdown.textContent = count;
                
                if (count <= 0) {
                    clearInterval(interval);
                    window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
                }
            }, 1000);
        </script>
    </body>
    </html>
    """

@app.route('/log')
@guest_allowed
def logs_page():
    """Page des logs d'audit (Admin uniquement)"""
    if not current_user.is_admin:
        abort(403)
        
    page = request.args.get('page', 1, type=int)
    action_filter = request.args.get('action')
    actor_filter = request.args.get('actor')
    severity_filter = request.args.get('severity')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    query = AuditLog.query
    
    if action_filter:
        query = query.filter(AuditLog.action_type == action_filter)
        
    if actor_filter:
        actor = User.query.filter_by(username=actor_filter).first()
        if actor:
            query = query.filter(AuditLog.actor_id == actor.id)
            
    if severity_filter == 'high':
        query = query.filter(AuditLog.action_type.in_(['BAN_USER', 'BAN_IP', 'DELETE_MESSAGE', 'KICK']))
    elif severity_filter == 'medium':
        query = query.filter(AuditLog.action_type.in_(['PROMOTE', 'DEMOTE', 'EDIT_MESSAGE', 'SHADOWBAN']))
        
    if start_date:
        query = query.filter(db.func.date(AuditLog.created_at) >= start_date)
    if end_date:
        query = query.filter(db.func.date(AuditLog.created_at) <= end_date)
            
    pagination = query.order_by(AuditLog.created_at.desc()).paginate(page=page, per_page=50)
    
    action_types = db.session.query(AuditLog.action_type).distinct().all()
    action_types = [a[0] for a in action_types]
    
    return render_template('logs.html', pagination=pagination, action_types=action_types, theme=THEME)

@app.route('/membre')
@guest_allowed
def members_page():
    """Annuaire des membres"""
    search = request.args.get('q', '')
    query = User.query
    
    if search:
        query = query.filter(User.username.ilike(f'%{search}%'))
        
    # On trie par nom d'utilisateur
    members = query.order_by(User.username.asc()).all()
    
    # Récupérer les statuts de présence en temps réel
    presences = {p.user_id: p.status for p in OnlinePresence.query.all()}
    
    return render_template('members.html', members=members, presences=presences, search=search, theme=THEME)

@app.route('/membre/<user_id>')
@login_required
def user_profile_by_id(user_id):
    """Page de profil utilisateur par ID"""
    user = User.query.get_or_404(user_id)
    
    # Statistiques pertinentes
    stats = {
        'messages_count': user.messages.count(),
        'files_count': user.sent_files.count(),
        'days_since_join': (datetime.now(timezone.utc) - user.created_at.replace(tzinfo=timezone.utc)).days
    }
    
    return render_template('profile.html', user=user, stats=stats, theme=THEME)

@app.route('/fichiers')
@guest_allowed
def files_gallery():
    """Galerie de fichiers publics"""
    # Récupérer tous les fichiers pour les filtres initiaux
    all_files = FileAttachment.query.order_by(FileAttachment.created_at.desc()).all()
    
    # Pré-calculer les comptes pour éviter les filtres Jinja2 complexes
    counts = {
        'all': len(all_files),
        'image': len([f for f in all_files if f.file_type and f.file_type.startswith('image/')]),
        'video': len([f for f in all_files if f.file_type and f.file_type.startswith('video/')]),
        'document': len([f for f in all_files if f.file_type and (f.file_type.startswith('application/') or f.file_type.startswith('text/'))])
    }
    
    # Récupérer la liste des uploadeurs uniques pour le filtre
    uploaders = db.session.query(User).join(FileAttachment, User.id == FileAttachment.uploader_id).distinct().all()
    
    # Types de fichiers uniques (extensions)
    extensions_query = db.session.query(db.func.substr(FileAttachment.original_filename, db.func.instr(FileAttachment.original_filename, '.') + 1)) \
        .filter(FileAttachment.original_filename.like('%.%')) \
        .distinct().all()
    extensions = [e[0].lower() for e in extensions_query if e[0]]
    
    return render_template('files.html', 
                         files=all_files[:100], # On limite l'affichage initial pour le lazy loading
                         counts=counts,
                         uploaders=uploaders,
                         extensions=sorted(list(set(extensions))),
                         theme=THEME)

@app.route('/api/admin/files/bulk-delete', methods=['POST'])
@login_required
def bulk_delete_files():
    """Suppression massive de fichiers (Admin Suprême uniquement)"""
    if current_user.role != UserRole.SUPREME:
        return jsonify({'error': 'Accès refusé. Niveau SUPREME requis.'}), 403
    
    data = request.json
    filter_type = data.get('filter_type') # 'user', 'type', 'date', 'range', 'all'
    filter_value = data.get('filter_value')
    
    query = FileAttachment.query
    
    if filter_type == 'user':
        query = query.filter_by(uploader_id=filter_value)
    elif filter_type == 'type':
        query = query.filter(FileAttachment.file_type.like(f'%{filter_value}%'))
    elif filter_type == 'date':
        target_date = datetime.strptime(filter_value, '%Y-%m-%d').date()
        query = query.filter(db.func.date(FileAttachment.created_at) == target_date)
    elif filter_type == 'range':
        start_date = datetime.strptime(data.get('start_date'), '%Y-%m-%d').date()
        end_date = datetime.strptime(data.get('end_date'), '%Y-%m-%d').date()
        query = query.filter(db.func.date(FileAttachment.created_at).between(start_date, end_date))
    elif filter_type == 'all':
        pass # Supprimer tout
    else:
        return jsonify({'error': 'Filtre invalide'}), 400
    
    files_to_delete = query.all()
    deleted_count = 0
    
    for f in files_to_delete:
        try:
            # Supprimer le fichier physique
            if os.path.exists(f.file_path):
                os.remove(f.file_path)
            if f.thumbnail_path and os.path.exists(f.thumbnail_path):
                os.remove(f.thumbnail_path)
            
            db.session.delete(f)
            deleted_count += 1
        except Exception as e:
            print(f"Erreur lors de la suppression de {f.id}: {e}")
            
    db.session.commit()
    
    log_action(current_user, ActionType.DELETE_MESSAGE, # On réutilise un type existant ou on pourrait en créer un
               details=f'Suppression massive: {deleted_count} fichiers (Filtre: {filter_type})')
    
    return jsonify({'success': True, 'deleted_count': deleted_count})

@app.route('/parametre')
@guest_allowed
def settings_page():
    """Paramètres utilisateur"""
    try:
        user_theme = current_user.theme if current_user.is_authenticated else 'dark'
    except Exception:
        user_theme = 'dark'
    return render_template('settings.html', user=current_user, theme=user_theme)

@app.route('/credits')
@guest_allowed
def credits_page():
    """Page des crédits"""
    from models import Contributor
    contributors = Contributor.query.order_by(Contributor.order).all()
    # Grouper par catégorie
    grouped_credits = {}
    for c in contributors:
        if c.category not in grouped_credits:
            grouped_credits[c.category] = []
        grouped_credits[c.category].append(c)
    
    return render_template('credits.html', theme=THEME, grouped_credits=grouped_credits)

@app.route('/jeux')
@login_required
def game_page():
    return render_template('game.html', theme=THEME)

@app.route('/battleship')
@login_required
def battleship_index():
    return send_from_directory(str(BATTLESHIP_DIST_DIR), 'index.html')

@app.route('/battleship/<path:filename>')
@login_required
def battleship_assets(filename):
    return send_from_directory(str(BATTLESHIP_DIST_DIR), filename)

@app.route('/game/battleship-main/battleship-main/dist/index.html')
@login_required
def battleship_index_legacy():
    return """<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap" rel="stylesheet"><title>Battleship Game</title><script src="/static/js/socket.io.min.js"></script><script defer src="/static/js/battleship_pvp.js"></script><script defer="defer" src="bundle.js"></script></head><body><div class="mainPage"><img class="shipIcon" src="ship.svg" alt="Ship Icon" style="height: 50px; width: auto;"/><h1 class="title">Battleship Game</h1><button class="startButton">START GAME</button><p class="copyright">© 2023 by Alex Arroyo</p></div></body></html>"""

@app.route('/game/battleship-main/battleship-main/dist/<path:filename>')
@login_required
def battleship_assets_legacy(filename):
    return send_from_directory(str(BATTLESHIP_DIST_DIR), filename)


@app.route('/jeux/<code>')
@login_required
def game_lobby(code):
    with _GAME_SESSIONS_LOCK:
        session_data = _GAME_SESSIONS.get(code.upper())
    if not session_data:
        return redirect(url_for('game_page'))
    return render_template('game.html', theme=THEME)

@app.route('/jeux/<code>/battleship')
@login_required
def battleship_native(code):
    return render_template('jeux/battleship.html', theme=THEME)

@app.route('/<username>')
@login_required
def user_profile(username):
    """Page de profil utilisateur"""
    user = User.query.filter_by(username=username).first_or_404()
    return render_template('profile.html', user=user, theme=THEME)

@app.route('/<username>/bio')
@login_required
def user_bio(username):
    """Page bio détaillée"""
    user = User.query.filter_by(username=username).first_or_404()
    return render_template('profile_bio.html', user=user, theme=THEME)

@app.route('/<username>/pdp')
@login_required
def user_pdp(username):
    """Page photo de profil plein écran"""
    user = User.query.filter_by(username=username).first_or_404()
    return render_template('profile_pdp.html', user=user, theme=THEME)

@app.route('/erreur')
def error_page():
    """Page d'erreur dynamique"""
    code = request.args.get('code', '404')
    variant_title = None
    variant_message = None
    try:
        variants_path = Path(__file__).with_name('error_variants.json')
        with open(variants_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        entries = data.get(str(code))
        if isinstance(entries, list) and entries:
            chosen = random.choice(entries)
            variant_title = chosen.get('title') or ''
            variant_message = chosen.get('message') or ''
    except Exception:
        pass
    if not variant_title:
        variant_title = "ANOMALIE"
    if not variant_message:
        variant_message = "Une erreur est survenue."
    return render_template('error.html', code=code, theme=THEME, variant_title=variant_title, variant_message=variant_message)

@app.errorhandler(403)
def forbidden(e):
    return redirect(url_for('error_page', code='403'))

@app.errorhandler(404)
def page_not_found(e):
    return redirect(url_for('error_page', code='404'))

@app.errorhandler(500)
def internal_server_error(e):
    return redirect(url_for('error_page', code='500'))

@app.errorhandler(401)
def unauthorized(e):
    return redirect(url_for('error_page', code='401'))

@app.route('/guest')
def guest_page():
    """Page dédiée aux invités (sans compte)"""
    return render_template('guest_access.html',
                           is_authenticated=current_user.is_authenticated,
                           theme=THEME)

@app.route('/guest-troll')
def guest_troll_page():
    """Page spéciale pour troller les connectés ou accueillir les invités (Étape 8)"""
    return redirect(url_for('guest_page'))

@app.route('/api/guest/session', methods=['POST'])
def guest_session_update():
    data = request.get_json(silent=True) or {}
    clean = {
        'affinity': int(data.get('affinity') or 0),
        'mood': str(data.get('mood') or 'neutral')[:32],
        'inventory': list(map(str, data.get('inventory') or []))[:50],
        'flags': dict(data.get('flags') or {}),
        'history': list(map(str, data.get('history') or []))[:500],
        'ts': datetime.now(timezone.utc).isoformat()
    }
    session['guest_state'] = clean
    try:
        base = pathlib.Path(app.root_path) / 'logs' / 'guest_sessions'
        base.mkdir(parents=True, exist_ok=True)
        uid = str(getattr(current_user, 'id', 'anonymous'))
        fpath = base / f'session_{uid}.jsonl'
        with open(fpath, 'a', encoding='utf-8') as f:
            f.write(json.dumps(clean, ensure_ascii=False) + '\n')
    except Exception as e:
        pass
    return jsonify({'ok': True})

@app.route('/api/guest/log', methods=['POST'])
def guest_dialogue_log():
    data = request.get_json(silent=True) or {}
    entry = {
        'scene': str(data.get('scene') or ''),
        'text': str(data.get('text') or '')[:2000],
        'vars': data.get('vars') or {},
        'choice': data.get('choice') or None,
        'ts': datetime.now(timezone.utc).isoformat()
    }
    try:
        base = pathlib.Path(app.root_path) / 'logs' / 'guest_dialogues'
        base.mkdir(parents=True, exist_ok=True)
        uid = str(getattr(current_user, 'id', 'anonymous'))
        fpath = base / f'dialogues_{uid}.jsonl'
        with open(fpath, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception:
        pass
    return jsonify({'ok': True})
# ============================================
# INITIALISATION BASE DE DONNÉES
# ============================================
def init_db():
    """Initialise la base de données avec les salons par défaut"""
    try:
        with app.app_context():
            db.create_all()
            
            # Migration: Ajout de la colonne channel_id si manquante
            try:
                with db.engine.connect() as conn:
                    # Tentative d'ajout de la colonne (échouera si elle existe déjà)
                    # Note: SQLite ne supporte pas IF NOT EXISTS pour ADD COLUMN dans toutes les versions
                    # On utilise text() pour la compatibilité SQLAlchemy
                    from sqlalchemy import text
                    conn.execute(text('ALTER TABLE file_attachments ADD COLUMN channel_id VARCHAR(36)'))
                    conn.commit()
                    print("  Migration: Colonne channel_id ajoutée à file_attachments")
            except Exception:
                # La colonne existe probablement déjà ou erreur mineure
                pass
            
            # Créer les salons par défaut si inexistants (seulement 2 channels)
            if Channel.query.count() == 0:
                default_channels = [
                    Channel(name='général', description='Salon principal pour tous', category='Discussion'),
                    Channel(name='admin', description='Salon réservé aux administrateurs', category='Administration', is_read_only=False),
                ]
                    
                db.session.add_all(default_channels)
                db.session.commit()
                print("  Salons créés: #général, #admin")
    except Exception as e:
        print(f"  Avertissement: Erreur lors de l'initialisation de la base de données: {e}")

# ============================================
# POINT D'ENTRÉE
# ============================================
if __name__ == '__main__':
    # S'assurer que le répertoire data existe (important pour disque externe)
    import os
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except PermissionError:
        print(f"  Avertissement: Impossible de créer {DATA_DIR}. Utilisation du dossier courant.")
        # Utiliser un dossier alternatif dans le répertoire courant
        import sys
        DATA_DIR = Path.cwd() / 'data'
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    init_db()
    
    print("=" * 60)
    print("  KRONOS - Système de Communication Souverain")
    print("=" * 60)
    print(f"  Base de données: {DB_PATH}")
    print(f"  Dossier uploads: {UPLOADS_DIR}")
    print("=" * 60)
    print("  Accédez à: http://localhost:5000")
    print("=" * 60)
    
    socketio.run(app, 
                 host='0.0.0.0', 
                 port=5000, 
                 debug=DEBUG)
