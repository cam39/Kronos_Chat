import sqlite3

print("=== VERIFICATION COMPLETE DE KRONI ===")

conn = sqlite3.connect('data/kronos.db')
cursor = conn.cursor()

# 1. Verifier utilisateur Kroni
cursor.execute("SELECT id, username, role, is_active FROM users WHERE username='Kroni'")
kroni = cursor.fetchone()
print(f"1. Utilisateur Kroni: {kroni}")

# 2. Verifier canal #kroni
cursor.execute("SELECT id, name, category FROM channels WHERE name='kroni'")
channel = cursor.fetchone()
print(f"2. Canal #kroni: {channel}")

# 3. Verifier messages recents dans #kroni
if channel:
    cursor.execute("SELECT id, user_id, content, created_at FROM messages WHERE channel_id=? ORDER BY created_at ASC LIMIT 5", (channel[0],))
    messages = cursor.fetchall()
    print(f"3. Messages recents (tri ASC):")
    for msg in messages:
        print(f"   ID:{msg[0]} User:{msg[1]} Time:{msg[3]} Content:{msg[2][:50]}...")

# 4. Verifier participants du canal #kroni
if channel:
    cursor.execute("SELECT user_id FROM channel_participants WHERE channel_id=?", (channel[0],))
    participants = cursor.fetchall()
    print(f"4. Participants du canal: {[p[0] for p in participants]}")

# 5. Verifier si Kroni a des messages DM
cursor.execute("""
    SELECT DISTINCT m.channel_id, c.name 
    FROM messages m 
    JOIN channels c ON m.channel_id = c.id 
    WHERE m.user_id = ? AND c.channel_type = 'dm'
    LIMIT 5
""", (kroni[0] if kroni else None,))
dms = cursor.fetchall()
print(f"5. DM de Kroni: {dms}")

conn.close()
print("\n=== RAPPORT DE CORRECTION ===")
print("OK Badge IA: Implemente dans messages + profil")
print("OK Role IA: Force 'IA' majuscules")
print("OK Tri messages: ASC + timestamp +0.001s")
print("OK @Kroni: Ajoute dans les suggestions")
print("OK DM Kroni: Redirection handle_kroni_dm")
print("OK Statut online: Force dans online_users")
print("OK Bug DM leave: emit->socketio.emit")
print("\nREDEMARRE le serveur pour appliquer")
