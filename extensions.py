# Extensions partagées KRONOS
# Ce fichier initialise les extensions Flask pour éviter les imports circulaires

from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_mail import Mail

# Extensions globales
db = SQLAlchemy()
login_manager = LoginManager()
mail = Mail()
