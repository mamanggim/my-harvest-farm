import { auth, database, ref, onValue, set, get } from '../firebase/firebase-config.js';

// Tunggu DOM siap
document.addEventListener('DOMContentLoaded', () => {
  let isLoggingOut = false; // Flag buat tandain logout
  let lastNotificationTime = 0; // Buat batasin notif berulang

  // Cek kalau udah pernah redirect biar ga loop
  const redirectFlag = sessionStorage.getItem('adminRedirect');
  if (redirectFlag) {
    sessionStorage.removeItem('adminRedirect');
    return;
  }

  // Cek auth sekali aja
  auth.onAuthStateChanged((user) => {
    if (user) {
      // Cek role admin
      get(ref(database, `players/${encodeEmail(user.email)}/role`))
        .then((snapshot) => {
          const role = snapshot.val();
          if (role === 'admin') {
            // Lanjut ke dashboard
            // Setup FCM (komentar dulu, panggil kalo butuh)
            /*
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.register('/firebase/firebase-messaging-sw.js')
                .then((registration) => {
                  messaging.useServiceWorker(registration);
                  return messaging.getToken();
                })
                .then((token) => {
                  set(ref(database, `adminTokens/${user.uid}`), token);
                })
                .catch((err) => {
                  showUserNotification('Failed to setup notifications.');
                });
            }
            */
          } else {
            showUserNotification('Access denied. Admins only.');
            auth.signOut().then(() => {
              sessionStorage.setItem('adminRedirect', 'true');
              window.location.href = '/index.html';
            });
          }
        })
        .catch((err) => {
          showUserNotification('Error checking permissions. Please login again.');
          auth.signOut().then(() => {
            sessionStorage.setItem('adminRedirect', 'true');
            window.location.href = '/index.html';
          });
        });
    } else if (!isLoggingOut) {
      showUserNotification('Please login first.');
      sessionStorage.setItem('adminRedirect', 'true');
      window.location.href = '/index.html';
    }
  });

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      isLoggingOut = true;
      auth.signOut().then(() => {
        sessionStorage.setItem('adminRedirect', 'true');
        window.location.href = '/index.html';
      }).catch((err) => {
        showUserNotification('Error logging out. Try again.');
      });
    });
  }

  // Admin Dashboard
  onValue(ref(database, 'transactions'), (snapshot) => {
    const transactions = snapshot.val();
    const depositItems = document.getElementById('deposit-items');
    const pendingCount = document.getElementById('pending-count');
    const approvedToday = document.getElementById('approved-today');

    if (depositItems && pendingCount && approvedToday) {
      depositItems.innerHTML = '';
      let pending = 0;
      let approvedTodayCount = 0;
      const today = new Date().toISOString().split('T')[0];
      let newDepositFound = false;

      if (transactions) {
        for (let id in transactions) {
          const t = transactions[id];
          if (t.type === 'deposit') {
            if (t.status === 'pending') {
              pending++;
              // Cek apakah ini deposit baru (contoh: berdasarkan timestamp)
              if (!newDepositFound && (!t.lastNotified || Date.now() - t.lastNotified > 60000)) { // 1 menit cooldown
                newDepositFound = true;
                showUserNotification(`New deposit request from ${t.email} for ${t.amount} PI`);
                set(ref(database, `transactions/${id}/lastNotified`), Date.now()); // Tandai udah dinotif
              }
            }
            if (t.status === 'approved' && new Date(t.timestamp).toISOString().split('T')[0] === today) {
              approvedTodayCount++;
            }

            let timeLeft = t.expiresAt ? Math.max(0, Math.floor((t.expiresAt - Date.now()) / 1000)) : 0;
            if (timeLeft <= 0 && t.status === 'pending') {
              set(ref(database, `transactions/${id}/status`), 'cancelled');
              continue;
            }

            depositItems.innerHTML += `
              <tr>
                <td class="text-limit">${t.email}</td>
                <td>${t.amount} PI</td>
                <td class="text-limit">${t.memo || '-'}</td>
                <td class="text-limit">${new Date(t.timestamp).toLocaleString()}</td>
                <td>${t.status}</td>
                <td id="countdown-${id}">${timeLeft} sec</td>
                <td>
                  <button class="game-button" onclick="approveDeposit('${id}')">Approve</button>
                  <button class="game-button" onclick="rejectDeposit('${id}')">Reject</button>
                </td>
              </tr>
            `;

            if (t.status === 'pending') {
              const countdownElement = document.getElementById(`countdown-${id}`);
              const interval = setInterval(() => {
                timeLeft--;
                countdownElement.textContent = `${timeLeft} sec`;
                if (timeLeft <= 0) {
                  clearInterval(interval);
                  set(ref(database, `transactions/${id}/status`), 'cancelled');
                }
              }, 1000);
            }
          }
        }
      }

      pendingCount.textContent = pending;
      approvedToday.textContent = approvedTodayCount;
    }
  });

  window.approveDeposit = function(id) {
    set(ref(database, `transactions/${id}/status`), 'approved')
      .then(() => {
        get(ref(database, `transactions/${id}`)).then((snap) => {
          const transaction = snap.val();
          if (transaction && transaction.type === 'deposit') {
            const userRef = ref(database, `players/${encodeEmail(transaction.email)}`);
            get(userRef).then((playerSnap) => {
              const player = playerSnap.val();
              if (player) {
                set(userRef, {
                  ...player,
                  piBalance: (player.piBalance || 0) + parseFloat(transaction.amount)
                });
                showUserNotification(`Deposit ${transaction.amount} PI approved!`);
              } else {
                showUserNotification('User not found. Deposit approved but balance not updated.');
              }
            });
          } else {
            showUserNotification('Invalid transaction data.');
          }
        });
      })
      .catch((err) => {
        showUserNotification('Error approving deposit.');
      });
  };

  window.rejectDeposit = function(id) {
    set(ref(database, `transactions/${id}/status`), 'rejected')
      .then(() => {
        get(ref(database, `transactions/${id}`)).then((snap) => {
          const transaction = snap.val();
          showUserNotification(`Deposit ${transaction.amount} PI rejected. Contact support.`);
        });
      })
      .catch((err) => {
        showUserNotification('Error rejecting deposit.');
      });
  };

  function showUserNotification(message) {
    const notification = document.getElementById('notification');
    if (notification) {
      notification.textContent = message;
      notification.style.display = 'block';
      setTimeout(() => notification.style.display = 'none', 5000);
    }
  }

  function encodeEmail(email) {
    return email.replace('@', '_at_').replace('.', '_dot_');
  }
});
