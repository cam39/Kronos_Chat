/**
 * KRONOS - Service Worker
 * Gestion avancée des notifications et du cache
 */

const CACHE_NAME = 'kronos-notifications-v1';
const UNREAD_NOTIFICATIONS_STORE = 'unread-notifications';

self.addEventListener('install', (event) => {
    console.log('[KRONOS SW] Installation...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[KRONOS SW] Activation...');
    event.waitUntil(self.clients.claim());
});

// Cache local pour le batching
let notificationQueue = [];
let batchTimeout = null;
const BATCH_DELAY = 2000; // 2 secondes pour grouper les notifications

/**
 * Persistance des notifications non lues via IndexedDB
 */
const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('kronos_db', 1);
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('unread_notifications')) {
            db.createObjectStore('unread_notifications', { keyPath: 'id' });
        }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
});

async function saveToUnread(notif) {
    const db = await dbPromise;
    const tx = db.transaction('unread_notifications', 'readwrite');
    tx.objectStore('unread_notifications').put({
        id: notif.id || Date.now().toString(),
        author: notif.author,
        content: notif.body,
        timestamp: Date.now(),
        channel_id: notif.channel_id
    });
}

/**
 * Traite la file d'attente des notifications (Batching)
 */
async function processNotificationQueue() {
    if (notificationQueue.length === 0) return;

    // Sauvegarde en cache local pour chaque notif
    for (const notif of notificationQueue) {
        await saveToUnread(notif);
    }

    if (notificationQueue.length === 1) {
        const notif = notificationQueue[0];
        showSingleNotification(notif);
    } else {
        showBatchNotification(notificationQueue);
    }
    
    notificationQueue = [];
    batchTimeout = null;
}

/**
 * Affiche une notification unique
 */
function showSingleNotification(data) {
    const title = data.title || 'KRONOS';
    const options = {
        body: data.body || '',
        icon: '/static/icons/favicon.svg',
        badge: '/static/icons/favicon.svg',
        tag: data.tag || 'kronos-mention',
        data: { url: data.url || '/' },
        timestamp: Date.now()
    };
    self.registration.showNotification(title, options);
}

/**
 * Affiche une notification groupée
 */
function showBatchNotification(queue) {
    const count = queue.length;
    const title = `KRONOS - ${count} nouvelles mentions`;
    const bodies = queue.map(n => `${n.author || 'Inconnu'}: ${n.body}`).slice(0, 3);
    if (count > 3) bodies.push(`... et ${count - 3} autres`);
    
    const options = {
        body: bodies.join('\n'),
        icon: '/static/icons/favicon.svg',
        badge: '/static/icons/favicon.svg',
        tag: 'kronos-batch',
        data: { url: '/' },
        timestamp: Date.now()
    };
    self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'KRONOS', body: event.data.text() };
    }

    // Ajout à la file pour batching
    notificationQueue.push(data);
    
    if (batchTimeout) clearTimeout(batchTimeout);
    batchTimeout = setTimeout(processNotificationQueue, BATCH_DELAY);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const urlToOpen = event.notification.data.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Si l'onglet est déjà ouvert, on lui donne le focus
            for (let client of windowClients) {
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // Sinon on ouvre un nouvel onglet
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// Communication avec l'application principale
self.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'MENTION') {
        const data = {
            id: event.data.id,
            title: event.data.title,
            body: event.data.body,
            author: event.data.author,
            channel_id: event.data.channel_id,
            tag: 'mention-' + (event.data.channel_id || 'global'),
            url: event.data.url
        };

        // Batching pour les messages reçus via postMessage aussi
        notificationQueue.push(data);
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(processNotificationQueue, BATCH_DELAY);
    } else if (event.data.type === 'CLEAR_UNREAD') {
        dbPromise.then(db => {
            const tx = db.transaction('unread_notifications', 'readwrite');
            tx.objectStore('unread_notifications').clear();
        });
    } else if (event.data.type === 'GET_UNREAD') {
        dbPromise.then(db => {
            const tx = db.transaction('unread_notifications', 'readonly');
            const request = tx.objectStore('unread_notifications').getAll();
            request.onsuccess = () => {
                event.source.postMessage({
                    type: 'UNREAD_LIST',
                    notifications: request.result
                });
            };
        });
    }
});
