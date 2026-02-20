# Modèles de Données KRONOS
# Système de Communication Souverain

from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
import uuid

# Importer db depuis extensions
from extensions import db

# ============================================
# FONCTION UTILITAIRE POUR DATETIME
# ============================================
def get_current_utc_time():
    """Retourne l'heure UTC actuelle, compatible avec les futures versions de Python"""
    return datetime.now(timezone.utc)

# ============================================
# ÉNUMÉRATIONS
# ============================================
class UserRole:
    MEMBER = "member"
    MODERATOR = "moderator"
    ADMIN = "admin"
    SUPREME = "supreme"

class MessageType:
    TEXT = "text"
    FILE = "file"
    SYSTEM = "system"

class ChannelType:
    PUBLIC = "public"
    PRIVATE = "private"
    DM = "dm"

class ActionType:
    BAN_USER = "ban_user"
    UNBAN_USER = "unban_user"
    BAN_IP = "ban_ip"
    UNBAN_IP = "unban_ip"
    SHADOWBAN = "shadowban"
    UNSHADOWBAN = "unshadowban"
    KICK = "kick"
    PROMOTE = "promote"
    DEMOTE = "demote"
    DELETE_MESSAGE = "delete_message"
    EDIT_MESSAGE = "edit_message"
    UPLOAD_FILE = "upload_file"

# ============================================
# MODÈLE UTILISATEUR
# ============================================
class User(UserMixin, db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    
    # Profil
    display_name = db.Column(db.String(100), nullable=True)
    bio = db.Column(db.Text, nullable=True)
    avatar_filename = db.Column(db.String(255), nullable=True)
    banner_filename = db.Column(db.String(255), nullable=True)
    
    # Rôle et statut
    role = db.Column(db.String(20), default=UserRole.MEMBER, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_shadowbanned = db.Column(db.Boolean, default=False, nullable=False)
    
    # Informations de ban
    ban_reason = db.Column(db.Text, nullable=True)  # Raison du ban (si is_active=False)
    banned_at = db.Column(db.DateTime, nullable=True)  # Date du ban
    banned_by = db.Column(db.String(36), nullable=True)  # ID de l'admin qui a banni
    
    last_seen = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    # IP tracking pour la sécurité
    last_ip = db.Column(db.String(45), nullable=True)  # Dernière IP de connexion
    
    mute_until = db.Column(db.DateTime, nullable=True)
    
    # Récupération de compte
    reset_token = db.Column(db.String(36), nullable=True)
    reset_token_expires_at = db.Column(db.DateTime, nullable=True)
    
    # Panic Mode personnel (chaque utilisateur peut définir son propre lien)
    personal_panic_url = db.Column(db.String(500), nullable=True)
    personal_panic_hotkey = db.Column(db.String(50), nullable=True)
    
    # Paramètres d'apparence
    theme = db.Column(db.String(20), default='dark', nullable=False)
    notif_sound = db.Column(db.Boolean, default=True, nullable=False)
    animations_enabled = db.Column(db.Boolean, default=True, nullable=False)
    
    # Relations
    messages = db.relationship('Message', backref='author', lazy='dynamic',
                               foreign_keys='Message.user_id')
    sent_files = db.relationship('FileAttachment', backref='uploader', lazy='dynamic')
    audit_logs = db.relationship('AuditLog', backref='actor', lazy='dynamic',
                                 foreign_keys='AuditLog.actor_id')
    
    @property
    def is_admin(self):
        return self.role in [UserRole.ADMIN, UserRole.SUPREME]
    
    @property
    def is_supreme(self):
        return self.role == UserRole.SUPREME
    
    def get_avatar_url(self):
        if self.avatar_filename:
            return f"/uploads/avatars/{self.avatar_filename}"
        return "/static/icons/default_avatar.svg"
    
    def get_banner_url(self):
        if self.banner_filename:
            return f"/uploads/banners/{self.banner_filename}"
        return None
    
    def set_password(self, password):
        from config import HASH_ALGORITHM
        self.password_hash = generate_password_hash(password, method=HASH_ALGORITHM)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self, include_sensitive=False):
        data = {
            'id': self.id,
            'username': self.username,
            'display_name': self.display_name or self.username,
            'avatar': self.get_avatar_url(),
            'banner': self.get_banner_url(),
            'bio': self.bio,
            'role': self.role,
            'is_admin': self.is_admin,
            'is_supreme': self.is_supreme,
            'is_active': self.is_active,
            'is_shadowbanned': self.is_shadowbanned,
            'ban_reason': self.ban_reason if include_sensitive else None,
            'banned_at': self.banned_at.isoformat() if self.banned_at else None,
            'banned_by': self.banned_by if include_sensitive else None,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_ip': self.last_ip if include_sensitive else None,
            'personal_panic_url': self.personal_panic_url if include_sensitive else None,
            'personal_panic_hotkey': self.personal_panic_hotkey if include_sensitive else None,
            'mute_until': self.mute_until.isoformat() if self.mute_until else None,
        }
        return data
    
    def set_ban_info(self, reason, banned_by_id):
        """Enregistre les informations de ban"""
        self.is_active = False
        self.ban_reason = reason
        self.banned_at = get_current_utc_time()
        self.banned_by = banned_by_id
    
    def clear_ban_info(self):
        """Efface les informations de ban (pour unban)"""
        self.is_active = True
        self.ban_reason = None
        self.banned_at = None
        self.banned_by = None

# ============================================
# MODÈLE SALON (CHANNEL)
# ============================================
class Channel(db.Model):
    __tablename__ = 'channels'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    channel_type = db.Column(db.String(20), default=ChannelType.PUBLIC, nullable=False)
    category = db.Column(db.String(100), nullable=True)
    order = db.Column(db.Integer, default=0, nullable=False)
    
    # Permissions
    is_read_only = db.Column(db.Boolean, default=False, nullable=False)
    
    # Relations
    messages = db.relationship('Message', backref='channel', lazy='dynamic',
                               foreign_keys='Message.channel_id')
    participants = db.relationship('ChannelParticipant', backref='channel', lazy='dynamic')
    
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'type': self.channel_type,
            'category': self.category,
            'order': self.order,
            'is_read_only': self.is_read_only,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

# ============================================
# MODÈLE PARTICIPANT SALON
# ============================================
class ChannelParticipant(db.Model):
    __tablename__ = 'channel_participants'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id = db.Column(db.String(36), db.ForeignKey('channels.id'), nullable=False)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    joined_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    is_muted = db.Column(db.Boolean, default=False, nullable=False)
    
    __table_args__ = (
        db.UniqueConstraint('channel_id', 'user_id', name='unique_channel_user'),
    )

# ============================================
# MODÈLE MESSAGE
# ============================================
class Message(db.Model):
    __tablename__ = 'messages'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id = db.Column(db.String(36), db.ForeignKey('channels.id'), nullable=False, index=True)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False, index=True)
    
    # Contenu
    content = db.Column(db.Text, nullable=True)
    message_type = db.Column(db.String(20), default=MessageType.TEXT, nullable=False)
    
    # Citations
    reply_to_id = db.Column(db.String(36), db.ForeignKey('messages.id'), nullable=True)
    
    # Métadonnées
    is_edited = db.Column(db.Boolean, default=False, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False, index=True)
    edited_at = db.Column(db.DateTime, nullable=True)
    
    __table_args__ = (
        db.Index('idx_message_channel_composite', 'channel_id', 'created_at'),
        # Index composite pour l'isolation stricte des messages par canal (remplace (roomId, roomType, msgId))
        # channel_id étant unique et lié à un type de canal via la table channels, cela suffit.
        db.Index('idx_message_full_composite', 'channel_id', 'id'),
    )
    
    # Relations
    reply_to = db.relationship('Message', remote_side=[id], backref='replies')
    reactions = db.relationship('MessageReaction', backref='message', lazy='dynamic',
                                cascade='all, delete-orphan')
    attachments = db.relationship('FileAttachment', backref='message', lazy='dynamic',
                                  cascade='all, delete-orphan')
    read_by = db.relationship('MessageRead', backref='message', lazy='dynamic',
                              cascade='all, delete-orphan')
    
    def to_dict(self, include_author=True, include_reactions=True, include_attachments=True):
        data = {
            'id': self.id,
            'channel_id': self.channel_id,
            'content': self.content if not self.is_deleted else "[Message supprimé]",
            'type': self.message_type,
            'reply_to_id': self.reply_to_id,
            'is_edited': self.is_edited,
            'is_deleted': self.is_deleted,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'edited_at': self.edited_at.isoformat() if self.edited_at else None,
        }
        
        if include_author and self.author:
            data['author'] = self.author.to_dict(include_sensitive=False)
        
        if include_reactions:
            data['reactions'] = [r.to_dict() for r in self.reactions]
        
        if include_attachments:
            data['attachments'] = [a.to_dict() for a in self.attachments]
        
        if self.reply_to:
            data['reply_to'] = {
                'id': self.reply_to.id,
                'content': self.reply_to.content[:100] if self.reply_to.content else None,
                'author_name': self.reply_to.author.display_name if self.reply_to.author else None,
            }
        
        return data

# ============================================
# MODÈLE MESSAGES ÉPINGLÉS
# ============================================
class MessagePin(db.Model):
    __tablename__ = 'message_pins'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id = db.Column(db.String(36), db.ForeignKey('channels.id'), nullable=False, index=True)
    message_id = db.Column(db.String(36), db.ForeignKey('messages.id'), nullable=False, unique=True)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    __table_args__ = (
        db.UniqueConstraint('channel_id', 'message_id', name='unique_pin_per_channel'),
    )
    
    def to_dict(self):
        return {
            'id': self.id,
            'channel_id': self.channel_id,
            'message_id': self.message_id,
            'user_id': self.user_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

# ============================================
# MODÈLE RÉACTIONS
# ============================================
class MessageReaction(db.Model):
    __tablename__ = 'message_reactions'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    message_id = db.Column(db.String(36), db.ForeignKey('messages.id'), nullable=False)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    emoji = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    __table_args__ = (
        db.UniqueConstraint('message_id', 'user_id', 'emoji', name='unique_reaction'),
    )

# ============================================
# MODÈLE FICHIERS JOINTS
# ============================================
class FileAttachment(db.Model):
    __tablename__ = 'file_attachments'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    message_id = db.Column(db.String(36), db.ForeignKey('messages.id'), nullable=True)
    channel_id = db.Column(db.String(36), db.ForeignKey('channels.id'), nullable=True, index=True)
    uploader_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.String(50), nullable=False)
    file_size = db.Column(db.Integer, nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    thumbnail_path = db.Column(db.String(500), nullable=True)
    
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'channel_id': self.channel_id,
            'filename': self.filename,
            'original_filename': self.original_filename,
            'type': self.file_type,
            'size': self.file_size,
            'url': f"/uploads/files/{self.id}",
            'uploader': self.uploader.to_dict(include_sensitive=False) if self.uploader else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'thumbnail': f"/uploads/files/.thumbs/{self.id}.jpg" if self.thumbnail_path else None,
            'is_image': self.file_type in ('image', 'gif'),
            'is_video': self.file_type == 'video',
            'is_audio': self.file_type == 'audio',
            'is_document': self.file_type in ('document', 'pdf'),
            'is_file': self.file_type == 'file',
        }

# ============================================
# MODÈLE IP BANNIE
# ============================================
class BannedIP(db.Model):
    __tablename__ = 'banned_ips'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ip_address = db.Column(db.String(45), unique=True, nullable=False, index=True)
    reason = db.Column(db.Text, nullable=True)
    banned_by = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'ip_address': self.ip_address,
            'reason': self.reason,
            'banned_by': self.banned_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

# ============================================
# MODÈLE JOURNAL D'AUDIT
# ============================================
class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    action_type = db.Column(db.String(50), nullable=False)
    target_id = db.Column(db.String(36), nullable=True)
    target_type = db.Column(db.String(50), nullable=True)
    details = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False, index=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'actor_id': self.actor_id,
            'action_type': self.action_type,
            'target_id': self.target_id,
            'target_type': self.target_type,
            'details': self.details,
            'ip_address': self.ip_address,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

# ============================================
# MODÈLE CONTRIBUTEURS (CRÉDITS)
# ============================================
class Contributor(db.Model):
    __tablename__ = 'contributors'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False) # e.g., 'PRINCIPAL', 'PLAYTESTER', 'RESEAU'
    description = db.Column(db.Text, nullable=True)
    avatar_letter = db.Column(db.String(1), nullable=False)
    order = db.Column(db.Integer, default=0)
    
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'role': self.role,
            'category': self.category,
            'description': self.description,
            'avatar_letter': self.avatar_letter,
            'order': self.order
        }

# ============================================
# MODÈLE LECTURE DE MESSAGE
# ============================================
class MessageRead(db.Model):
    __tablename__ = 'message_reads'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    message_id = db.Column(db.String(36), db.ForeignKey('messages.id'), nullable=False)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    read_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    __table_args__ = (
        db.UniqueConstraint('message_id', 'user_id', name='unique_message_read'),
    )

# ============================================
# MODÈLE PRÉSENCE EN LIGNE
# ============================================
class OnlinePresence(db.Model):
    __tablename__ = 'online_presence'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('users.id'), unique=True, nullable=False)
    socket_id = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(20), default='online', nullable=False)
    current_channel = db.Column(db.String(36), nullable=True)
    is_typing = db.Column(db.Boolean, default=False, nullable=False)
    typing_channel = db.Column(db.String(36), nullable=True)
    last_ping = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'status': self.status,
            'current_channel': self.current_channel,
            'is_typing': self.is_typing,
            'typing_channel': self.typing_channel,
            'last_ping': self.last_ping.isoformat() if self.last_ping else None,
        }

# ============================================
# MODÈLE PARTIE BATTLESHIP
# ============================================
class GameSession(db.Model):
    __tablename__ = 'game_sessions'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(50), default='Battleship', nullable=False)
    game_type = db.Column(db.String(50), default='battleship', nullable=False)
    is_private = db.Column(db.Boolean, default=False, nullable=False)
    join_code = db.Column(db.String(20), nullable=True)
    created_by_id = db.Column(db.String(36), db.ForeignKey('users.id'), nullable=False)
    max_players = db.Column(db.Integer, default=2, nullable=False)
    players_json = db.Column(db.JSON, default=list, nullable=False)
    state_json = db.Column(db.JSON, default=dict, nullable=False)
    current_turn_user_id = db.Column(db.String(36), nullable=True)
    code = db.Column(db.String(12), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), default='waiting', nullable=False)
    mode = db.Column(db.String(10), default='pvp', nullable=False)
    p1_id = db.Column(db.String(36), nullable=True)
    p2_id = db.Column(db.String(36), nullable=True)
    p1_ready = db.Column(db.Boolean, default=False, nullable=False)
    p2_ready = db.Column(db.Boolean, default=False, nullable=False)
    current_turn = db.Column(db.String(2), nullable=True)
    p1_board = db.Column(db.JSON, nullable=True)
    p2_board = db.Column(db.JSON, nullable=True)
    history = db.Column(db.JSON, nullable=True)
    spectators = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_current_utc_time, onupdate=get_current_utc_time, nullable=False)

    def to_dict(self):
        return {
            'name': self.name,
            'game_type': self.game_type,
            'is_private': self.is_private,
            'join_code': self.join_code,
            'created_by_id': self.created_by_id,
            'max_players': self.max_players,
            'players_json': self.players_json or [],
            'state_json': self.state_json or {},
            'code': self.code,
            'status': self.status,
            'mode': self.mode,
            'p1_id': self.p1_id,
            'p2_id': self.p2_id,
            'p1_ready': self.p1_ready,
            'p2_ready': self.p2_ready,
            'current_turn': self.current_turn,
            'p1_board': self.p1_board,
            'p2_board': self.p2_board,
            'history': self.history or [],
            'spectators': self.spectators or [],
        }

# ============================================
# MODÈLE SYSTÈME D'EMAIL (AUTONOME)
# ============================================
class EmailStatus:
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"
    RETRYING = "retrying"

class EmailMessage(db.Model):
    __tablename__ = 'email_messages'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient = db.Column(db.String(120), nullable=False, index=True)
    subject = db.Column(db.String(200), nullable=False)
    body_html = db.Column(db.Text, nullable=False)
    
    # État de l'envoi
    status = db.Column(db.String(20), default=EmailStatus.PENDING, nullable=False)
    attempts = db.Column(db.Integer, default=0, nullable=False)
    max_retries = db.Column(db.Integer, default=3, nullable=False)
    last_attempt = db.Column(db.DateTime, nullable=True)
    error_log = db.Column(db.Text, nullable=True)
    sent_at = db.Column(db.DateTime, nullable=True)
    
    # Statistiques d'ouverture
    is_opened = db.Column(db.Boolean, default=False, nullable=False)
    opened_at = db.Column(db.DateTime, nullable=True)
    
    created_at = db.Column(db.DateTime, default=get_current_utc_time, nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'recipient': self.recipient,
            'subject': self.subject,
            'status': self.status,
            'attempts': self.attempts,
            'last_attempt': self.last_attempt.isoformat() if self.last_attempt else None,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None,
            'error_log': self.error_log,
            'is_opened': self.is_opened,
            'opened_at': self.opened_at.isoformat() if self.opened_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
