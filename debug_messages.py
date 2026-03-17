import sqlite3
import datetime

print("=== ANALYSE DES MESSAGES RECENTS ===")

conn = sqlite3.connect('data/kronos.db')
cursor = conn.cursor()

# 1. Vérifier les messages des 24h
cursor.execute("""
    SELECT m.id, m.user_id, u.username, m.channel_id, c.name as channel_name, 
           m.content, m.created_at, m.is_deleted
    FROM messages m
    JOIN users u ON m.user_id = u.id
    JOIN channels c ON m.channel_id = c.id
    WHERE m.created_at > datetime('now', '-1 day')
    ORDER BY m.created_at DESC
    LIMIT 10
""")

messages = cursor.fetchall()
print(f"Messages des 24h: {len(messages)}")
for msg in messages:
    print(f"  {msg[6]} | {msg[2]} | #{msg[4]} | {msg[5][:50]}...")

# 2. Vérifier les messages par canal
cursor.execute("""
    SELECT c.name, COUNT(m.id) as msg_count
    FROM channels c
    LEFT JOIN messages m ON c.id = m.channel_id AND m.is_deleted = 0
    GROUP BY c.id, c.name
    ORDER BY msg_count DESC
""")

channels = cursor.fetchall()
print(f"\nMessages par canal:")
for ch in channels:
    print(f"  #{ch[0]}: {ch[1]} messages")

# 3. Vérifier les utilisateurs actifs
cursor.execute("""
    SELECT DISTINCT u.username, COUNT(m.id) as msg_count
    FROM users u
    JOIN messages m ON u.id = m.user_id AND m.is_deleted = 0
    WHERE m.created_at > datetime('now', '-1 day')
    GROUP BY u.id, u.username
    ORDER BY msg_count DESC
""")

users = cursor.fetchall()
print(f"\nUtilisateurs actifs (24h):")
for u in users:
    print(f"  {u[0]}: {u[1]} messages")

conn.close()
print("\n=== FIN ANALYSE ===")
