document.addEventListener('DOMContentLoaded', () => {

    const screens = {
        mode: document.getElementById('mode-screen'),
        category: document.getElementById('category-screen'),
        mpMenu: document.getElementById('multiplayer-menu'),
        createRoom: document.getElementById('create-room-screen'),
        joinRoom: document.getElementById('join-room-screen'),
        lobby: document.getElementById('lobby-screen'),
        loading: document.getElementById('loading-screen'),
        game: document.getElementById('game-screen'),
        result: document.getElementById('result-screen')
    };

    const el = {
        nicknameInput: document.getElementById('nickname-input'),
        singlePlayerBtn: document.getElementById('single-player-btn'),
        multiPlayerBtn: document.getElementById('multi-player-btn'),
        categoryGrid: document.getElementById('category-grid'),
        mpCategoryGrid: document.getElementById('mp-category-grid'),
        createRoomBtn: document.getElementById('create-room-btn'),
        joinRoomBtn: document.getElementById('join-room-btn'),
        roomCodeInput: document.getElementById('room-code-input'),
        joinRoomSubmitBtn: document.getElementById('join-room-submit-btn'),
        refreshRoomsBtn: document.getElementById('refresh-rooms-btn'),
        lobbyRoomCode: document.getElementById('lobby-room-code'),
        lobbyCategory: document.getElementById('lobby-category'),
        lobbyQuestionCount: document.getElementById('lobby-question-count'),
        playerList: document.getElementById('player-list'),
        playerCount: document.getElementById('player-count'),
        startGameBtn: document.getElementById('start-game-btn'),
        leaveRoomBtn: document.getElementById('leave-room-btn'),
        copyCodeBtn: document.getElementById('copy-code-btn'),
        questionText: document.getElementById('question-text'),
        questionCategory: document.getElementById('question-category'),
        optionsGrid: document.getElementById('options-grid'),
        score: document.getElementById('score'),
        timer: document.getElementById('timer'),
        progressBar: document.getElementById('progress-bar'),
        questionCounter: document.getElementById('question-counter'),
        loadingText: document.getElementById('loading-text'),
        resultTitle: document.getElementById('result-title'),
        finalScore: document.getElementById('final-score'),
        totalCorrect: document.getElementById('total-correct'),
        totalWrong: document.getElementById('total-wrong'),
        singleResults: document.getElementById('single-player-results'),
        multiResults: document.getElementById('multiplayer-results'),
        winnerName: document.getElementById('winner-name'),
        leaderboardList: document.getElementById('leaderboard-list'),
        restartBtn: document.getElementById('restart-btn'),
        sourceBadge: document.getElementById('question-source'),
        mpIpInfo: document.getElementById('mp-ip-info'),
        mpServerAddress: document.getElementById('mp-server-address'),
        exitGameBtn: document.getElementById('exit-game-btn'),
        roomList: document.getElementById('room-list'),
        questionCountSelect: document.getElementById('question-count-select')
    };

    const CATEGORIES = [
        "Genel K\u00fclt\u00fcr", "Tarih", "Co\u011frafya", "Bilim", "Spor",
        "Futbol", "Siyaset", "Uzay", "Fizik", "Oyun"
    ];
    const TIMER_DURATION = 10;
    const SCORE_CORRECT = 300;
    const SCORE_WRONG = -200;
    const SCORE_EMPTY = -100;

    let state = {
        isMultiplayer: false,
        socket: null,
        roomCode: null,
        isHost: false,
        playerName: '',
        selectedCategory: '',
        questionSource: 'API',
        questionCount: 20,
        questions: [],
        questionIndex: 0,
        score: 0,
        correct: 0,
        wrong: 0,
        timeLeft: TIMER_DURATION,
        timerInterval: null,
        isAnswering: false,
        mySelectedAnswer: null
    };

    initCategoryGrids();
    attachEventListeners();
    initIpEditButtons();

    const savedNickname = localStorage.getItem('playerNickname');
    if (savedNickname) el.nicknameInput.value = savedNickname;

    function initCategoryGrids() {
        [el.categoryGrid, el.mpCategoryGrid].forEach((grid, idx) => {
            grid.innerHTML = '';
            CATEGORIES.forEach(cat => {
                const btn = document.createElement('button');
                btn.className = 'cat-btn';
                btn.textContent = cat;
                btn.onclick = () => idx === 0 ? startSinglePlayer(cat) : startMultiplayerRoom(cat);
                grid.appendChild(btn);
            });
        });
    }

    function attachEventListeners() {
        el.singlePlayerBtn.addEventListener('click', () => {
            if (!validateNickname()) return;
            state.isMultiplayer = false;
            showScreen(screens.category);
        });

        el.multiPlayerBtn.addEventListener('click', () => {
            if (!validateNickname()) return;
            state.isMultiplayer = true;
            if (connectToServer()) showScreen(screens.mpMenu);
        });

        el.createRoomBtn.addEventListener('click', () => showScreen(screens.createRoom));

        el.joinRoomBtn.addEventListener('click', () => {
            showScreen(screens.joinRoom);
            fetchAvailableRooms();
        });

        el.refreshRoomsBtn?.addEventListener('click', () => {
            el.refreshRoomsBtn.classList.add('spinning');
            fetchAvailableRooms();
            setTimeout(() => el.refreshRoomsBtn.classList.remove('spinning'), 800);
        });

        el.joinRoomSubmitBtn.addEventListener('click', handleJoinRoom);
        el.roomCodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleJoinRoom(); });
        el.startGameBtn.addEventListener('click', handleStartGame);
        el.leaveRoomBtn.addEventListener('click', () => { if (state.socket) state.socket.disconnect(); resetGame(); });
        el.copyCodeBtn.addEventListener('click', copyRoomCode);
        el.restartBtn.addEventListener('click', resetGame);

        el.exitGameBtn?.addEventListener('click', () => {
            if (!confirm('Oyundan \u00e7\u0131kmak istedi\u011finize emin misiniz?')) return;
            el.sourceBadge?.classList.add('hidden');
            if (state.isMultiplayer && state.socket) {
                state.socket.disconnect();
                el.mpIpInfo?.classList.add('hidden');
            }
            resetGame();
        });
    }

    function validateNickname() {
        const name = el.nicknameInput.value.trim();
        if (!name) { alert('L\u00fctfen bir takma ad girin!'); return false; }
        state.playerName = name;
        localStorage.setItem('playerNickname', name);
        return true;
    }

    function showScreen(screen) {
        Object.values(screens).forEach(s => s.classList.add('hidden'));
        screen.classList.remove('hidden');
    }

    window.backToMode = () => { if (state.socket) state.socket.disconnect(); showScreen(screens.mode); };
    window.backToMultiplayerMenu = () => showScreen(screens.mpMenu);

    function updateServerAddress(ip, port) {
        if (el.mpIpInfo && el.mpServerAddress) {
            el.mpServerAddress.textContent = `http://${ip}:${port}`;
            el.mpIpInfo.classList.remove('hidden');
        }
    }

    function initIpEditButtons() {
        const editBtn = document.getElementById('edit-ip-btn');
        const editInput = document.getElementById('ip-edit-input');
        const copyIpBtn = document.getElementById('copy-ip-btn');
        copyIpBtn?.addEventListener('click', () => {
            navigator.clipboard.writeText(el.mpServerAddress.textContent).then(() => {
                copyIpBtn.textContent = '\u2705';
                setTimeout(() => copyIpBtn.textContent = '\ud83d\udccb', 2000);
            });
        });
        editBtn?.addEventListener('click', () => {
            if (editInput.classList.contains('hidden')) {
                editInput.value = el.mpServerAddress.textContent.replace('http://', '');
                editInput.classList.remove('hidden');
                editBtn.textContent = '\u2705';
            } else {
                const val = editInput.value.trim();
                const parts = val.split(':');
                if (parts.length === 2 && parts[0] && parts[1]) {
                    updateServerAddress(parts[0].trim(), parts[1].trim());
                    editInput.classList.add('hidden');
                    editBtn.textContent = '\u270f\ufe0f';
                } else if (!val) {
                    editInput.classList.add('hidden');
                    editBtn.textContent = '\u270f\ufe0f';
                } else {
                    alert('IP:Port format\u0131nda girin (\u00d6rn: 192.168.1.100:3000)');
                }
            }
        });
        editInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') editBtn?.click(); });
        editInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { editInput.classList.add('hidden'); editBtn.textContent = '\u270f\ufe0f'; }
        });
    }

    // ==================== SOCKET.IO ====================
    function connectToServer() {
        if (state.socket?.connected) return true;
        if (typeof io === 'undefined') { alert('Socket.io y\u00fcklenemedi!'); return false; }
        try {
            let url = window.location.origin;
            if (window.location.port !== '3000') url = 'http://127.0.0.1:3000';
            state.socket = io(url, { reconnectionAttempts: 3, timeout: 5000 });
        } catch (err) { alert('Ba\u011flant\u0131 hatas\u0131: ' + err.message); return false; }

        const s = state.socket;
        s.on('connect_error', () => {
            if (!s._ae) { alert('Sunucuya ba\u011flan\u0131lamad\u0131! Sunucunun \u00e7al\u0131\u015ft\u0131\u011f\u0131ndan emin olun.'); s._ae = true; }
        });
        s.on('connect', () => { s._ae = false; });
        s.on('serverInfo', (data) => updateServerAddress(data.ip, data.port));

        s.on('roomCreated', (data) => {
            state.roomCode = data.roomCode;
            state.isHost = true;
            state.questionCount = data.questionCount || 20;
            el.lobbyRoomCode.textContent = data.roomCode;
            el.lobbyCategory.innerHTML = `Kategori: <strong>${state.selectedCategory}</strong>`;
            if (el.lobbyQuestionCount) el.lobbyQuestionCount.textContent = state.questionCount;
            updatePlayerList(data.players);
            el.startGameBtn.style.display = 'block';
            showScreen(screens.lobby);
        });

        s.on('roomJoined', (data) => {
            state.roomCode = data.roomCode;
            state.isHost = false;
            state.questionCount = data.questionCount || 20;
            el.lobbyRoomCode.textContent = data.roomCode;
            el.lobbyCategory.innerHTML = `Kategori: <strong>${data.category}</strong>`;
            if (el.lobbyQuestionCount) el.lobbyQuestionCount.textContent = state.questionCount;
            updatePlayerList(data.players);
            el.startGameBtn.style.display = 'none';
            showScreen(screens.lobby);
        });

        s.on('playerJoined', (data) => updatePlayerList(data.players));
        s.on('playerLeft', (data) => updatePlayerList(data.players));

        s.on('gameStarted', () => {
            state.score = 0;
            state.correct = 0;
            state.wrong = 0;
            updateScoreUI();
            showScreen(screens.game);
        });

        s.on('newQuestion', (data) => loadMultiplayerQuestion(data));

        // Cevap alindi - sadece butonlari kilitle
        s.on('answerReceived', () => {});

        // Dogru cevap aciklandi - herkes gorur
        s.on('revealAnswer', (data) => handleMultiplayerReveal(data));

        s.on('scoresUpdate', () => {});
        s.on('gameEnded', (data) => showMultiplayerResults(data));
        s.on('roomList', (data) => renderRoomList(data.rooms || []));
        s.on('roomClosed', (data) => { alert(data.reason || 'Oda kapat\u0131ld\u0131'); resetGame(); });
        s.on('error', (msg) => { alert('Hata: ' + msg); showScreen(screens.mpMenu); });
        return true;
    }

    // ==================== TEK OYUNCU ====================
    async function startSinglePlayer(category) {
        state.selectedCategory = category;
        showScreen(screens.loading);
        el.loadingText.textContent = 'Sorular Haz\u0131rlan\u0131yor...';
        try {
            const { questions, source } = await fetchQuestions(category, 20);
            if (!questions || questions.length < 10) throw new Error('Yetersiz soru');
            state.questions = questions;
            state.questionSource = source;
            beginSinglePlayerGame();
        } catch (err) {
            showScreen(screens.category);
            alert('Sorular al\u0131namad\u0131!\n\n' + err.message);
        }
    }

    function beginSinglePlayerGame() {
        state.score = 0; state.correct = 0; state.wrong = 0; state.questionIndex = 0;
        updateScoreUI();
        showScreen(screens.game);
        loadSinglePlayerQuestion();
    }

    function loadSinglePlayerQuestion() {
        if (state.questionIndex >= state.questions.length) return endSinglePlayerGame();
        const q = state.questions[state.questionIndex];
        el.questionText.textContent = q.q;
        el.questionCategory.textContent = q.c || q.category;
        el.questionCounter.textContent = `Soru ${state.questionIndex + 1} / ${state.questions.length}`;
        showSourceBadge(state.questionSource);
        resetTimer();
        el.optionsGrid.innerHTML = '';
        q.o.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt.t || opt.text;
            btn.dataset.id = opt.id;
            btn.onclick = () => handleSinglePlayerAnswer(opt.id, q.a || q.correctAnswer);
            el.optionsGrid.appendChild(btn);
        });
        state.isAnswering = false;
        startTimer(() => handleSinglePlayerAnswer(null, q.a || q.correctAnswer));
    }

    function handleSinglePlayerAnswer(selectedId, correctId) {
        if (state.isAnswering) return;
        state.isAnswering = true;
        stopTimer();
        el.optionsGrid.querySelectorAll('.option-btn').forEach(btn => {
            if (btn.dataset.id === correctId) btn.classList.add('correct');
            if (selectedId && selectedId !== correctId && btn.dataset.id === selectedId) btn.classList.add('wrong');
        });
        if (selectedId === correctId) { state.score += SCORE_CORRECT; state.correct++; }
        else if (selectedId) { state.score += SCORE_WRONG; state.wrong++; }
        else { state.score += SCORE_EMPTY; state.wrong++; }
        updateScoreUI();
        setTimeout(() => { state.questionIndex++; loadSinglePlayerQuestion(); }, 1500);
    }

    function endSinglePlayerGame() {
        el.sourceBadge?.classList.add('hidden');
        el.resultTitle.textContent = 'Oyun Bitti!';
        el.finalScore.textContent = state.score;
        el.totalCorrect.textContent = state.correct;
        el.totalWrong.textContent = state.wrong;
        el.singleResults.style.display = 'block';
        el.multiResults.style.display = 'none';
        showScreen(screens.result);
    }

    // ==================== COK OYUNCU ====================
    async function startMultiplayerRoom(category) {
        if (!state.socket?.connected) { alert('Sunucu ba\u011flant\u0131s\u0131 yok!'); return; }
        state.selectedCategory = category;
        state.questionCount = el.questionCountSelect ? parseInt(el.questionCountSelect.value) : 20;
        showScreen(screens.loading);
        el.loadingText.textContent = 'Oda Olu\u015fturuluyor...';
        try {
            const { questions, source } = await fetchQuestions(category, state.questionCount);
            if (!questions || questions.length < 5) throw new Error('Yetersiz soru');
            state.questions = questions;
            state.questionSource = source;
            state.socket.emit('createRoom', {
                playerName: state.playerName,
                category,
                questionCount: state.questionCount
            });
        } catch (err) {
            alert('Sorular haz\u0131rlanamad\u0131: ' + err.message);
            showScreen(screens.createRoom);
        }
    }

    function handleJoinRoom() {
        const code = el.roomCodeInput.value.trim().toUpperCase();
        if (code.length !== 6) { alert('6 haneli oda kodunu girin!'); return; }
        if (!state.socket) { alert('Sunucu ba\u011flant\u0131s\u0131 yok!'); return; }
        showScreen(screens.loading);
        el.loadingText.textContent = 'Odaya Kat\u0131l\u0131n\u0131yor...';
        state.socket.emit('joinRoom', { roomCode: code, playerName: state.playerName });
    }

    function handleStartGame() {
        if (!state.isHost || !state.socket) return;
        state.socket.emit('startGame', { roomCode: state.roomCode, questions: state.questions });
    }

    function copyRoomCode() {
        navigator.clipboard.writeText(el.lobbyRoomCode.textContent)
            .then(() => { el.copyCodeBtn.textContent = '\u2705'; setTimeout(() => el.copyCodeBtn.textContent = '\ud83d\udccb', 1500); })
            .catch(() => prompt('Oda Kodu:', el.lobbyRoomCode.textContent));
    }

    function updatePlayerList(players) {
        el.playerList.innerHTML = '';
        el.playerCount.textContent = players.length;
        players.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'player-item';
            item.innerHTML = `<div class="player-info"><div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div><span class="player-name">${p.name}</span></div>${i === 0 ? '<span class="host-badge">HOST</span>' : ''}`;
            el.playerList.appendChild(item);
        });
    }

    function loadMultiplayerQuestion(data) {
        state.questionIndex = data.questionIndex;
        state.mySelectedAnswer = null;
        const q = data.question;
        el.questionText.textContent = q.q;
        el.questionCategory.textContent = q.category;
        el.questionCounter.textContent = `Soru ${data.questionIndex + 1} / ${data.totalQuestions}`;
        showSourceBadge(state.questionSource);
        resetTimer();
        el.optionsGrid.innerHTML = '';
        q.o.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt.t;
            btn.dataset.id = opt.id;
            btn.onclick = () => submitMultiplayerAnswer(opt.id);
            el.optionsGrid.appendChild(btn);
        });
        state.isAnswering = false;
        startTimer(() => {
            if (!state.isAnswering) submitMultiplayerAnswer(null);
        });
    }

    function submitMultiplayerAnswer(selectedId) {
        if (state.isAnswering) return;
        state.isAnswering = true;
        state.mySelectedAnswer = selectedId;
        if (!state.socket) return;

        state.socket.emit('submitAnswer', {
            roomCode: state.roomCode,
            questionIndex: state.questionIndex,
            selectedAnswer: selectedId,
            timeLeft: state.timeLeft
        });

        // Butonlari kilitle ama renk gosterme - herkes cevaplayana kadar bekle
        el.optionsGrid.querySelectorAll('.option-btn').forEach(btn => {
            btn.style.pointerEvents = 'none';
            if (selectedId && btn.dataset.id === selectedId) {
                btn.classList.add('selected');
            } else {
                btn.style.opacity = '0.6';
            }
        });
    }

    function handleMultiplayerReveal(data) {
        stopTimer();
        state.isAnswering = true;
        el.optionsGrid.querySelectorAll('.option-btn').forEach(btn => {
            btn.style.opacity = '1';
            btn.classList.remove('selected');
            if (btn.dataset.id === data.correctAnswer) btn.classList.add('correct');
            if (!data.isCorrect && data.selectedAnswer && btn.dataset.id === data.selectedAnswer) btn.classList.add('wrong');
        });
        if (data.isCorrect) state.correct++;
        else state.wrong++;
        state.score = data.newScore;
        updateScoreUI();
    }

    function showMultiplayerResults(data) {
        el.sourceBadge?.classList.add('hidden');
        el.mpIpInfo?.classList.add('hidden');
        el.resultTitle.textContent = 'Oyun Bitti!';
        el.winnerName.textContent = data.winner.name;
        el.leaderboardList.innerHTML = '';
        data.players.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            item.innerHTML = `<div class="leaderboard-left"><span class="leaderboard-rank">#${i + 1}</span><span class="leaderboard-name">${p.name}</span></div><span class="leaderboard-score">${p.score}</span>`;
            el.leaderboardList.appendChild(item);
        });
        el.singleResults.style.display = 'none';
        el.multiResults.style.display = 'block';
        showScreen(screens.result);
    }

    // ==================== LAN ODA KESFI ====================
    function fetchAvailableRooms() {
        if (!el.roomList) return;
        el.roomList.innerHTML = '<div class="room-list-empty"><span>\ud83d\udd0d</span><p>Odalar aran\u0131yor...</p></div>';
        if (state.socket?.connected) {
            state.socket.emit('getRooms');
        } else {
            let url = window.location.origin + '/rooms';
            if (window.location.port !== '3000') url = 'http://127.0.0.1:3000/rooms';
            fetch(url).then(r => r.json()).then(data => renderRoomList(data.rooms || []))
                .catch(() => { el.roomList.innerHTML = '<div class="room-list-empty"><span>\u26a0\ufe0f</span><p>Sunucuya ba\u011flan\u0131lamad\u0131</p></div>'; });
        }
    }

    function renderRoomList(rooms) {
        if (!el.roomList) return;
        if (rooms.length === 0) {
            el.roomList.innerHTML = '<div class="room-list-empty"><span>\ud83c\udfe0</span><p>Hen\u00fcz a\u00e7\u0131k oda yok</p></div>';
            return;
        }
        el.roomList.innerHTML = '';
        rooms.forEach(room => {
            const item = document.createElement('div');
            item.className = 'room-item';
            item.innerHTML = `<div class="room-info"><span class="room-host">\ud83d\udc64 ${room.hostName}</span><span class="room-category">\ud83d\udcda ${room.category} (${room.questionCount || 20} soru)</span></div><div class="room-details"><span class="room-players">\ud83d\udc65 ${room.playerCount}/10</span><span class="room-code-badge">${room.roomCode}</span></div><button class="join-room-btn">Kat\u0131l</button>`;
            item.addEventListener('click', (e) => { if (!e.target.classList.contains('join-room-btn')) joinRoomFromList(room.roomCode); });
            item.querySelector('.join-room-btn').addEventListener('click', (e) => { e.stopPropagation(); joinRoomFromList(room.roomCode); });
            el.roomList.appendChild(item);
        });
    }

    function joinRoomFromList(code) {
        if (!state.socket) { alert('Sunucu ba\u011flant\u0131s\u0131 yok!'); return; }
        showScreen(screens.loading);
        el.loadingText.textContent = 'Odaya Kat\u0131l\u0131n\u0131yor...';
        state.socket.emit('joinRoom', { roomCode: code, playerName: state.playerName });
    }

    // ==================== AI SORU URETIMI ====================
    async function fetchQuestions(category, questionCount) {
        let serverUrl = '';
        if (window.location.port !== '3000') serverUrl = 'http://127.0.0.1:3000';
        const resp = await fetch(`${serverUrl}/api/questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, questionCount: questionCount || 20 })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Bilinmeyen hata' }));
            throw new Error(err.error || `HTTP ${resp.status}`);
        }
        return resp.json();
    }

    // ==================== ZAMANLAYICI ====================
    function startTimer(onTimeUp) {
        state.timeLeft = TIMER_DURATION;
        updateTimerUI();
        state.timerInterval = setInterval(() => {
            state.timeLeft--;
            updateTimerUI();
            if (state.timeLeft <= 0) {
                stopTimer();
                if (onTimeUp) onTimeUp();
                // Multiplayer: host sure bitti sinyali gondersin
                if (state.isMultiplayer && state.isHost && state.socket) {
                    state.socket.emit('timeUp', { roomCode: state.roomCode, questionIndex: state.questionIndex });
                }
            }
        }, 1000);
    }

    function stopTimer() { clearInterval(state.timerInterval); }

    function resetTimer() {
        stopTimer();
        state.timeLeft = TIMER_DURATION;
        updateTimerUI();
        el.progressBar.style.width = '100%';
    }

    function updateTimerUI() {
        el.timer.textContent = state.timeLeft;
        el.progressBar.style.width = `${(state.timeLeft / TIMER_DURATION) * 100}%`;
    }

    function updateScoreUI() { el.score.textContent = state.score; }

    function showSourceBadge(source) {
        if (el.sourceBadge) { el.sourceBadge.classList.remove('hidden'); el.sourceBadge.textContent = source; }
    }

    function resetGame() {
        if (state.socket) { state.socket.disconnect(); state.socket = null; }
        state.isMultiplayer = false;
        state.roomCode = null;
        state.isHost = false;
        el.sourceBadge?.classList.add('hidden');
        el.mpIpInfo?.classList.add('hidden');
        showScreen(screens.mode);
    }
});