#!/usr/bin/env python3
"""
Script d'annonce mDNS/Zeroconf pour le serveur Kronos
Annonce la présence du serveur sur le réseau local toutes les 30 secondes
"""

import threading
import time
import socket
from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser
from typing import Optional


class Kronos ZeroconfAnnouncer:
    """Annonce le serveur Kronos sur le réseau local via mDNS"""
    
    def __init__(self, service_name: str = "Kronos", port: int = 5000):
        self.service_name = service_name
        self.port = port
        self.zeroconf: Optional[Zeroconf] = None
        self.service_info: Optional[ServiceInfo] = None
        self.running = False
        self.announce_thread: Optional[threading.Thread] = None
        
    def get_local_ip(self) -> str:
        """Récupère l'adresse IP locale de la machine"""
        try:
            # Créer une socket temporaire pour déterminer l'IP locale
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            return "127.0.0.1"
    
    def create_service_info(self) -> ServiceInfo:
        """Crée les informations du service mDNS"""
        local_ip = self.get_local_ip()
        
        # Type de service HTTP standard
        service_type = "_http._tcp.local."
        full_name = f"{self.service_name}.{service_type}"
        
        # Propriétés du service (informations additionnelles)
        properties = {
            "path": "/",
            "version": "1.0",
            "platform": "Kronos Chat Server"
        }
        
        # Créer les propriétés en bytes pour Zeroconf
        properties_bytes = {}
        for key, value in properties.items():
            if isinstance(value, str):
                properties_bytes[key.encode()] = value.encode()
            else:
                properties_bytes[key.encode()] = str(value).encode()
        
        service_info = ServiceInfo(
            service_type,
            full_name,
            addresses=[socket.inet_aton(local_ip)],
            port=self.port,
            properties=properties_bytes,
            server=f"{self.service_name.lower()}-local."
        )
        
        return service_info
    
    def start(self):
        """Démarre l'annonce du service"""
        if self.running:
            print(f"[Zeroconf] Le service est déjà en cours d'exécution")
            return
            
        try:
            # Initialiser Zeroconf
            self.zeroconf = Zeroconf()
            
            # Créer les informations du service
            self.service_info = self.create_service_info()
            
            # Enregistrer le service
            self.zeroconf.register_service(self.service_info)
            self.running = True
            
            local_ip = self.get_local_ip()
            print(f"[Zeroconf] Service '{self.service_name}' enregistré sur {local_ip}:{self.port}")
            print(f"[Zeroconf] Type: _http._tcp.local.")
            
            # Démarrer le thread de ré-annonce
            self.announce_thread = threading.Thread(target=self._announce_loop, daemon=True)
            self.announce_thread.start()
            
        except Exception as e:
            print(f"[Zeroconf] Erreur lors du démarrage: {e}")
            self.stop()
    
    def _announce_loop(self):
        """Boucle de ré-annonce toutes les 30 secondes"""
        while self.running:
            try:
                # Ré-enregistrer le service pour maintenir la présence
                if self.zeroconf and self.service_info:
                    self.zeroconf.register_service(self.service_info)
                    print(f"[Zeroconf] Ré-annonce du service - IP: {self.get_local_ip()}:{self.port}")
            except Exception as e:
                print(f"[Zeroconf] Erreur lors de la ré-annonce: {e}")
            
            # Attendre 30 secondes
            for _ in range(30):
                if not self.running:
                    break
                time.sleep(1)
    
    def update_port(self, new_port: int):
        """Met à jour le port du service"""
        self.port = new_port
        if self.running:
            self.stop()
            self.start()
    
    def stop(self):
        """Arrête l'annonce et libère les ressources"""
        self.running = False
        
        if self.zeroconf and self.service_info:
            try:
                self.zeroconf.unregister_service(self.service_info)
                print(f"[Zeroconf] Service '{self.service_name}' dé-enregistré")
            except Exception as e:
                print(f"[Zeroconf] Erreur lors de la désinscription: {e}")
        
        if self.zeroconf:
            try:
                self.zeroconf.close()
                print("[Zeroconf] Zeroconf fermé")
            except Exception as e:
                print(f"[Zeroconf] Erreur lors de la fermeture: {e}")
        
        self.zeroconf = None
        self.service_info = None


# Instance globale pour utilisation dans Flask
_zeroconf_announcer: Optional[KronosZeroconfAnnouncer] = None


def start_zeroconf(port: int = 5000):
    """Démarre l'annonce Zeroconf"""
    global _zeroconf_announcer
    if _zeroconf_announcer is None:
        _zeroconf_announcer = KronosZeroconfAnnouncer(port=port)
    _zeroconf_announcer.start()
    return _zeroconf_announcer


def stop_zeroconf():
    """Arrête l'annonce Zeroconf"""
    global _zeroconf_announcer
    if _zeroconf_announcer:
        _zeroconf_announcer.stop()
        _zeroconf_announcer = None


def get_zeroconf_status() -> dict:
    """Retourne le statut de Zeroconf"""
    global _zeroconf_announcer
    if _zeroconf_announcer and _zeroconf_announcer.running:
        return {
            "running": True,
            "ip": _zeroconf_announcer.get_local_ip(),
            "port": _zeroconf_announcer.port,
            "service_name": _zeroconf_announcer.service_name
        }
    return {"running": False}


if __name__ == "__main__":
    # Test autonome
    print("=== Test du module Zeroconf ===")
    
    announcer = KronosZeroconfAnnouncer(port=5000)
    
    try:
        announcer.start()
        print("Appuyez sur Ctrl+C pour arrêter...")
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nArrêt en cours...")
        announcer.stop()
        print("Terminé.")
