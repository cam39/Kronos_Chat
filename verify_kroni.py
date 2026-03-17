import sqlite3
conn = sqlite3.connect('data/kronos.db')
cursor = conn.cursor()
cursor.execute("SELECT id, username, role FROM users WHERE username='Kroni'")
print("Users:", cursor.fetchall())
cursor.execute("SELECT id, name, category FROM channels WHERE name='kroni'")
print("Channels:", cursor.fetchall())
conn.close()
