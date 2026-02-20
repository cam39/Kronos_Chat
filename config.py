# Configuration Principale KRONOS
# Système de Communication Souverain

import os
from pathlib import Path

# ============================================
# CHEMINS ET DOSSIERS
# ============================================
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"

# Création automatique des dossiers avec gestion d'erreurs
def create_directory_with_fallback(path, fallback_path=None):
    """Crée un dossier avec un chemin de fallback si permission refusée"""
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except PermissionError:
        if fallback_path:
            try:
                fallback_path.mkdir(parents=True, exist_ok=True)
                return fallback_path
            except PermissionError:
                # Dernier recours: utiliser le dossier courant
                import os
                current_dir = Path.cwd() / path.name
                current_dir.mkdir(parents=True, exist_ok=True)
                return current_dir
        return path

# Créer les dossiers avec gestion d'erreurs et utiliser les chemins effectifs
UPLOADS_DIR = create_directory_with_fallback(UPLOADS_DIR)
AVATARS_DIR = create_directory_with_fallback(UPLOADS_DIR / "avatars", UPLOADS_DIR)
BANNERS_DIR = create_directory_with_fallback(UPLOADS_DIR / "banners", UPLOADS_DIR)
FILES_DIR = create_directory_with_fallback(UPLOADS_DIR / "files", UPLOADS_DIR)
PRIVATE_UPLOADS_DIR = create_directory_with_fallback(UPLOADS_DIR / "private", UPLOADS_DIR)
DATA_DIR = create_directory_with_fallback(DATA_DIR)
DB_PATH = DATA_DIR / "kronos.db"

# ============================================
# CONFIGURATION FLASK
# ============================================
SECRET_KEY = os.environ.get('KRONOS_SECRET_KEY', os.urandom(32).hex())
SESSION_COOKIE_NAME = "kronos_session"
PERMANENT_SESSION_LIFETIME = 86400 * 7  # 7 jours

# ============================================
# CONFIGURATION SQLALCHEMY
# ============================================
SQLALCHEMY_DATABASE_URI = f"sqlite:///{DB_PATH}?timeout=30"
SQLALCHEMY_TRACK_MODIFICATIONS = False
SQLALCHEMY_ENGINE_OPTIONS = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

# ============================================
# SÉCURITÉ
# ============================================
# Hachage des mots de passe
HASH_ALGORITHM = "pbkdf2:sha256"
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCKOUT_TIME = 900  # 15 minutes

# Fichiers autorisés
ALLOWED_EXTENSIONS = {
    'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'ogg', 
    'mp4', 'webm', 'mkv', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 
    'ppt', 'pptx', 'py', 'js', 'html', 'css', 'json', 'md',
    # --- DOCUMENTS & BUREAUTIQUE ---
    'rtf', 'odt', 'pages', 'tex', 'wpd', 'wps', 'sxw', 'stw', 'dot', 'dotx', 
    'docm', 'dotm', 'epub', 'mobi', 'azw', 'azw3', 'djvu', 'oxps', 'xps', 'gdoc', 
    'xlsm', 'xlsb', 'xltx', 'xltm', 'ods', 'ots', 'csv', 'tsv', 'pptm', 'pot', 
    'potx', 'potm', 'pps', 'ppsx', 'ppsm', 'key', 'odp', 'otp', 'vcf', 'vcard',
    # --- DÉVELOPPEMENT (LANGAGES) ---
    'pyw', 'pyc', 'pyo', 'pyd', 'rb', 'rbw', 'java', 'class', 'jar', 'jsp', 
    'c', 'cpp', 'h', 'hpp', 'cc', 'cxx', 'cs', 'go', 'rs', 'swift', 'm', 'mm', 
    'kt', 'kts', 'dart', 'lua', 'pl', 'pm', 't', 'sh', 'bash', 'zsh', 'fish', 
    'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jsx', 'ts', 'tsx', 'wasm', 'erl', 
    'hrl', 'ex', 'exs', 'beam', 'clj', 'cljs', 'edn', 'scala', 'sc', 'ml', 'mli',
    'fs', 'fsi', 'fsx', 'fsscript', 'pas', 'pp', 'inc', 'asm', 's', 'r', 'rmd',
    # --- WEB & CONFIGURATION ---
    'htm', 'xhtml', 'jhtml', 'php', 'php3', 'php4', 'php5', 'phtml', 'asp', 
    'aspx', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'jsonp', 'rss', 
    'atom', 'scss', 'sass', 'less', 'styl', 'env', 'dockerfile', 'makefile', 
    'cmake', 'sql', 'sqlite', 'sqlite3', 'db', 'dbf', 'mdb', 'accdb', 'bak',
    # --- IMAGES & DESIGN ---
    'bmp', 'tiff', 'tif', 'svg', 'svgz', 'ai', 'eps', 'ps', 'psd', 'psb', 'xcf', 
    'indd', 'raw', 'arw', 'cr2', 'nrw', 'k25', 'dng', 'heic', 'heif', 'avif', 
    'ico', 'cur', 'ani', 'tga', 'dds', 'exr', 'hdr', 'jp2', 'j2k', 'jpf', 'jpx', 
    'jpm', 'mj2', 'jng', 'pcx', 'pnm', 'pbm', 'pgm', 'ppm', 'sketch', 'fig',
    # --- AUDIO & MUSIQUE ---
    'flac', 'm4a', 'aac', 'wma', 'aiff', 'aif', 'aifc', 'opus', 'pcm', 'alac', 
    'amr', 'ape', 'au', 'mka', 'mid', 'midi', 'kar', 'm3u', 'm3u8', 'pls', 
    'wpl', 'voc', 'ra', 'rm', 'ac3', 'dts', 'cda', 'mod', 'it', 'xm', 's3m',
    # --- VIDÉO & ANIMATION ---
    'avi', 'mov', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'm2v', 'm4p', 'amv', 
    'asf', 'vob', 'ogv', 'drc', 'mng', 'qt', 'yuv', 'rmvb', 'viv', 'asx', 
    'nsv', 'roq', 'svi', '3gp', '3g2', 'f4v', 'f4p', 'f4a', 'f4b', 'mts', 
    'm2ts', 'ts', 'vtt', 'srt', 'ass', 'ssa',
    # --- ARCHIVES & COMPRESSION ---
    'tar', 'gz', 'bz2', 'xz', 'tar.gz', 'tgz', 'tar.bz2', 'tbz2', 'zipx', 
    'sitx', 'iso', 'img', 'vcd', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'xpi', 
    'cab', 'msi', 'cpio', 'shar', 'ar', 'z', 'lz', 'lzma', 'lzo', 'rz', 
    'sz', 'zst', 'ace', 'alz', 'egg', 'par2',
    # --- SYSTÈME & EXÉCUTABLES ---
    'exe', 'com', 'bin', 'dll', 'sys', 'drv', 'reg', 'tmp', 'old', 'lnk', 
    'desktop', 'app', 'ipa', 'gadget', 'scr', 'cpl', 'msp', 'mst', 'efi',
    # --- POLICES (FONTS) ---
    'ttf', 'otf', 'woff', 'woff2', 'eot', 'fon', 'pfb', 'pfm', 'afm',
    # --- 3D & CAO ---
    'obj', 'stl', 'fbx', 'dae', '3ds', 'blend', 'ma', 'mb', 'max', 'c4d', 
    'skp', 'dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'ply', 'gltf', 'glb',
    # --- JEUX VIDÉO / ROMS ---
    'rom', 'nes', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'nds', '3ds', 'cia', 
    'n64', 'z64', 'cso', 'pbp', 'vpk', 'sav', 'pak', 'wad', 'vdf', 'gsa',
    # --- DATA & SCIENTIFIQUE ---
    'markdown', 'mdown', 'mkdn', 'bib', 'cls', 'sty', 'mat', 'ipynb', 
    'nb', 'fits', 'nc', 'asc', 'hdf5', 'h5', 'parquet', 'avro', 'orc', 
    'feather', 'dat', 'log', 'err', 'msg', 'msg', 'ost', 'pst'
}
MAX_CONTENT_LENGTH = 500 * 1024 * 1024  # 500MB

# ============================================
# CONFIGURATION EMAIL (SERVEUR INTERNE KRONOS)
# ============================================
# Le serveur mail est maintenant intégré directement à app.py
SMTP_HOST = os.environ.get('SMTP_HOST', '127.0.0.1')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 1025))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
SMTP_FROM = os.environ.get('SMTP_FROM', 'KRONOS <noreply@kronos.fr>')
SMTP_USE_TLS = False

# ============================================
# CONFIGURATION DU RELAIS (POUR ENVOI RÉEL)
# ============================================
# Si vous voulez envoyer vraiment sur internet via votre fournisseur (Orange, Free, etc.)
# Orange : smtp.orange.fr (port 465 ou 587)
# Free : smtp.free.fr (port 465 ou 587)
# SFR : smtp.sfr.fr (port 465 ou 587)
RELAY_HOST = os.environ.get('RELAY_HOST', '') # ex: 'smtp.orange.fr'
RELAY_PORT = int(os.environ.get('RELAY_PORT', 587))
RELAY_USER = os.environ.get('RELAY_USER', '') # Votre email chez le fournisseur
RELAY_PASSWORD = os.environ.get('RELAY_PASSWORD', '') # Votre mot de passe
RELAY_USE_TLS = os.environ.get('RELAY_USE_TLS', 'true').lower() == 'true'

# ============================================
# CONFIGURATION SOCKET.IO
# ============================================
SOCKETIO_ASYNC_MODE = "threading"
SOCKETIO_MESSAGE_QUEUE = None
SOCKETIO_PING_TIMEOUT = 60
SOCKETIO_PING_INTERVAL = 25

# ============================================
# ADMIN SUPREME
# ============================================
# Détection automatique de l'IP du serveur pour promotion Admin Suprême
import socket

def get_local_ip():
    """Détecte automatiquement l'IP locale de la machine"""
    try:
        # Créer une socket temporaire pour déterminer l'IP locale
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return "127.0.0.1"

# L'IP du serveur devient Admin Suprême automatiquement
SERVER_IP = get_local_ip()
print(f"[KRONOS] IP du serveur détectée: {SERVER_IP}")

# Peut être surchargé via variable d'environnement
ADMIN_SUPREME_IP = os.environ.get('KRONOS_ADMIN_IP', SERVER_IP)

# ============================================
# PANIC MODE (ANTI-WATCH)
# ============================================
PANIC_REDIRECT_URL = os.environ.get('KRONOS_PANIC_URL', "https://www.google.com")
PANIC_HOTKEY = "Control+Space"

# ============================================
# CONFIGURATION VOCALE (WebRTC)
# ============================================
ICE_SERVERS = [
    {"urls": "stun:stun.l.google.com:19302"},
    {"urls": "stun:stun1.l.google.com:19302"},
]

# ============================================
# PARAMÈTRES INTERFACE
# ============================================
# Design brutaliste - Palette de couleurs
THEME = {
    "bg_primary": "#09090b",      # Noir Profond
    "bg_secondary": "#18181b",    # Gris Sombre
    "bg_surface": "#27272a",      # Surface
    "text_primary": "#d4d4d8",    # Gris Zinc
    "text_secondary": "#a1a1aa",  # Gris Moyen
    "accent": "#ccff00",          # Acid Lime
    "danger": "#ff3333",          # Rouge Alerte
    "warning": "#ffaa00",         # Orange
    "success": "#00ff88",         # Vert Neon
    "admin": "#ff00ff",           # Magenta Admin
    "border": "#3f3f46",          # Bordures
}

# Messages par page lors du chargement
MESSAGES_PER_PAGE = 50

# Anti‑spam
ANTISPAM_ENABLED = True
ANTISPAM_RATE_COUNT = int(os.environ.get('KRONOS_ANTISPAM_RATE_COUNT', '8'))
ANTISPAM_RATE_WINDOW = int(os.environ.get('KRONOS_ANTISPAM_RATE_WINDOW', '30'))
ANTISPAM_DUPLICATE_WINDOW = int(os.environ.get('KRONOS_ANTISPAM_DUPLICATE_WINDOW', '30'))
ANTISPAM_MAX_LINKS = int(os.environ.get('KRONOS_ANTISPAM_MAX_LINKS', '3'))
ANTISPAM_MAX_MENTIONS = int(os.environ.get('KRONOS_ANTISPAM_MAX_MENTIONS', '5'))
ANTISPAM_MUTE_SECONDS = int(os.environ.get('KRONOS_ANTISPAM_MUTE_SECONDS', '10'))
ANTISPAM_MUTE_SECONDS = int(os.environ.get('KRONOS_ANTISPAM_MUTE_SECONDS', '300'))
ANTISPAM_BURST_COUNT = int(os.environ.get('KRONOS_ANTISPAM_BURST_COUNT', '5'))
ANTISPAM_BURST_WINDOW = int(os.environ.get('KRONOS_ANTISPAM_BURST_WINDOW', '3'))
ANTISPAM_SUSTAINED_COUNT = int(os.environ.get('KRONOS_ANTISPAM_SUSTAINED_COUNT', '15'))
ANTISPAM_SUSTAINED_WINDOW = int(os.environ.get('KRONOS_ANTISPAM_SUSTAINED_WINDOW', '60'))
ANTISPAM_DUP_SERIES_COUNT = int(os.environ.get('KRONOS_ANTISPAM_DUP_SERIES_COUNT', '3'))
ANTISPAM_DUP_SERIES_WINDOW = int(os.environ.get('KRONOS_ANTISPAM_DUP_SERIES_WINDOW', '10'))
ANTISPAM_PERSEC_COUNT = int(os.environ.get('KRONOS_ANTISPAM_PERSEC_COUNT', '3'))
ANTISPAM_PERSEC_WINDOW = int(os.environ.get('KRONOS_ANTISPAM_PERSEC_WINDOW', '1'))
ANTISPAM_REPEAT_CHAR_MIN = int(os.environ.get('KRONOS_ANTISPAM_REPEAT_CHAR_MIN', '6'))

# ============================================
# CONFIGURATION DEBUG
# ============================================
DEBUG = os.environ.get('KRONOS_DEBUG', 'False').lower() == 'true'
AUTO_REPAIR_DB = os.environ.get('KRONOS_AUTO_REPAIR_DB', 'False').lower() == 'true'
