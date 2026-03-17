import sqlite3
conn = sqlite3.connect('c:/Users/Camille/Documents/Kronos/kronos_chat_cleanV6/data/kronos.db')
cursor = conn.cursor()
cursor.execute("SELECT id, username, role FROM users WHERE username='Kroni'")
print("Users Kroni:", cursor.fetchall())
cursor.execute("SELECT id, name, category FROM channels WHERE name='kroni'")
print("Channels kroni:", cursor.fetchall())
conn.close()
