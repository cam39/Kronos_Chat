import sqlite3
conn = sqlite3.connect('data/kronos.db')
cursor = conn.cursor()

# Vérifier le rôle actuel de Kroni
cursor.execute('SELECT id, username, role FROM users WHERE username="Kroni"')
result = cursor.fetchone()
print(f"Avant: {result}")

# Forcer le rôle IA
if result:
    cursor.execute('UPDATE users SET role="IA" WHERE username="Kroni"')
    conn.commit()
    print("Rôle IA forcé en base de données")

# Vérifier après
cursor.execute('SELECT id, username, role FROM users WHERE username="Kroni"')
print(f"Après: {cursor.fetchone()}")

conn.close()
print("Terminé!")
