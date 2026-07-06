(function () {
    'use strict';

    // ================================================================
    // 一点开学习助手 — 精简版
    // 功能：批量伪造进度完成全部课程
    // ================================================================

    const PROGRESS_API = 'https://www.yidiankai.net/api/learning/progress';

    // ================================================================
    // 工具函数
    // ================================================================
    function getQueryParam(name) {
        const m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function getQueryParamFromStr(search, name) {
        const m = new RegExp('[?&]' + name + '=([^&#]*)').exec(search);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function getCourseIdFromPath() {
        const m = /\/courses\/([^\/]+)\/play/.exec(location.pathname);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function getCourseParams() {
        return {
            courseId: getCourseIdFromPath() || getQueryParam('courseId'),
            taskId: getQueryParam('taskId'),
            classroomId: getQueryParam('classroomId')
        };
    }

    // ================================================================
    // StatusCenter — 日志
    // ================================================================
    const StatusCenter = {
        _state: 'IDLE',
        _listeners: [],
        _logs: [],
        _maxLogs: 60,

        getState() { return this._state; },

        setState(s) {
            if (this._state !== s) {
                this._state = s;
                this._listeners.forEach(fn => fn(s));
            }
        },

        subscribe(fn) { this._listeners.push(fn); },

        log(msg, level) {
            level = level || 'info';
            const entry = {
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                level: level,
                msg: msg
            };
            this._logs.push(entry);
            if (this._logs.length > this._maxLogs) this._logs.shift();
            this._listeners.forEach(fn => fn(null, entry));
        },

        getLogs() { return this._logs; },
        clearLogs() { this._logs = []; this._listeners.forEach(fn => fn(this._state)); }
    };

    // ================================================================
    // TaskQueue — 可中断任务队列
    // ================================================================
    const TaskQueue = {
        _tasks: [],
        _running: false,
        _aborted: false,

        enqueue(task) { this._tasks.push(task); },

        async runNext() {
            if (this._aborted || this._tasks.length === 0) {
                this._running = false;
                return false;
            }
            this._running = true;
            const task = this._tasks.shift();
            try {
                await task();
            } catch (e) {
                StatusCenter.log('任务异常: ' + (e.message || e), 'error');
            }
            if (this._aborted) {
                this._running = false;
                return false;
            }
            return this.runNext();
        },

        abort() {
            this._aborted = true;
            this._tasks = [];
            this._running = false;
            StatusCenter.log('批量任务已取消', 'warn');
        },

        reset() {
            this._tasks = [];
            this._aborted = false;
            this._running = false;
        },

        remaining() { return this._tasks.length; }
    };

    // ================================================================
    // BatchComplete — 批量伪造进度
    // ================================================================
    const BatchComplete = {
        _active: false,

        start() {
            if (this._active) return;
            this._active = true;

            const items = document.querySelectorAll('a[href*="/courses/"][href*="/play?taskId="]');
            if (items.length === 0) {
                StatusCenter.log('未找到课程列表项', 'warn');
                this._active = false;
                return;
            }

            const params = getCourseParams();
            if (!params.courseId || !params.classroomId) {
                StatusCenter.log('无法获取 courseId/classroomId', 'warn');
                this._active = false;
                return;
            }

            const tasks = [];
            items.forEach((item, idx) => {
                const href = item.getAttribute('href') || '';
                const taskId = getQueryParamFromStr(href, 'taskId');
                const label = (item.getAttribute('aria-label') || ('第' + (idx + 1) + '集')).replace(/^切换到课时[:：]/, '');
                const timeText = (item.textContent.match(/\d+:\d{2}/) || [])[0] || '40:00';
                const parts = timeText.split(':').map(Number);
                const duration = parts.length === 2 ? (parts[0] * 60 + parts[1]) : 2400;
                tasks.push({ taskId, label, duration });
            });

            StatusCenter.log('开始批量完成 ' + tasks.length + ' 集 (间隔 800ms)', 'success');
            StatusCenter.setState('BATCH');

            TaskQueue.reset();
            tasks.forEach((t, idx) => {
                TaskQueue.enqueue(() => this._completeOne(params, t, idx, tasks.length));
            });

            TaskQueue.runNext().then(() => {
                if (!TaskQueue._aborted) {
                    StatusCenter.log('批量完成全部结束!', 'success');
                }
                StatusCenter.setState('IDLE');
                this._active = false;
            });
        },

        _completeOne(params, t, idx, total) {
            return new Promise((resolve) => {
                if (TaskQueue._aborted) { resolve(); return; }

                const body = {
                    courseId: params.courseId,
                    taskId: t.taskId,
                    classroomId: params.classroomId,
                    duration: t.duration,
                    progress: t.duration * 0.999
                };

                let retried = false;
                const send = () => {                    fetch(PROGRESS_API, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    }).then(resp => {
                        const lv = resp.status === 200 ? 'success' : 'warn';
                        StatusCenter.log('[' + (idx + 1) + '/' + total + '] ' + t.label + ' → HTTP ' + resp.status, lv);
                        resolve();
                    }).catch(err => {
                        if (!retried) {
                            retried = true;
                            StatusCenter.log('[' + (idx + 1) + '/' + total + '] ' + t.label + ' 重试中...', 'warn');
                            setTimeout(send, 1500);
                        } else {
                            StatusCenter.log('[' + (idx + 1) + '/' + total + '] ' + t.label + ' 失败: ' + (err.message || '网络错误'), 'error');
                            resolve();
                        }
                    });
                };
                setTimeout(send, idx === 0 ? 0 : 800);
            });
        },

        stop() {
            this._active = false;
            TaskQueue.abort();
        }
    };

    // ================================================================
    // UI — 精简面板
    // ================================================================
    const UI = {
        _el: {},
        _collapsed: false,

        create() {
            const style = document.createElement('style');
            style.textContent = `
                @keyframes yk-glow-pulse {
                    0%, 100% { opacity: 0.6; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.15); }
                }
                @keyframes yk-slide-in {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .yk-dot-active { animation: yk-glow-pulse 1.8s ease-in-out infinite; }
                .yk-panel-enter { animation: yk-slide-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); }
                #yk-log::-webkit-scrollbar { width: 4px; }
                #yk-log::-webkit-scrollbar-thumb { background: rgba(0, 255, 200, 0.2); border-radius: 2px; }
                #yk-panel button:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.2); }
                .yk-batch-bar-fill { transition: width 0.4s cubic-bezier(0.2,0.8,0.2,1); }
            `;
            document.head.appendChild(style);

            const panel = document.createElement('div');
            panel.id = 'yk-panel';
            panel.className = 'yk-panel-enter';
            const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            const panelTop = isMobile ? '12px' : '6vh';
            const panelRight = isMobile ? '12px' : '4vw';
            const panelWidth = isMobile ? '220px' : 'min(260px, 85vw)';
            const baseFontSize = isMobile ? '11px' : '12px';

            panel.style.cssText = [
                'position:fixed', 'right:' + panelRight, 'top:' + panelTop, 'z-index:999999',
                'width:' + panelWidth,
                'background:linear-gradient(135deg, rgba(10,15,30,0.85) 0%, rgba(15,20,40,0.8) 100%)',
                'backdrop-filter:blur(20px) saturate(180%)',
                '-webkit-backdrop-filter:blur(20px) saturate(180%)',
                'color:#e0e7ff',
                'border-radius:14px',
                'font-family:"SF Mono","JetBrains Mono",Consolas,monospace',
                'font-size:' + baseFontSize,
                'box-shadow:0 0 30px rgba(0,255,200,0.1),0 15px 40px rgba(0,0,0,0.5)',
                'overflow:hidden', 'user-select:none',
                'border:1px solid rgba(0,255,200,0.15)',
                'touch-action:none'
            ].join(';');

            panel.innerHTML = `
                <div id="yk-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:grab;background:linear-gradient(180deg, rgba(0,255,200,0.06) 0%, transparent 100%);border-bottom:1px solid rgba(0,255,200,0.1);">
                    <div style="display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:1.5px;">
                        <span id="yk-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6c7086;transition:all 0.3s;"></span>
                        <span style="background:linear-gradient(90deg,#00ffc8,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">批量完成</span>
                    </div>
                    <span id="yk-toggle-btn" style="font-size:12px;cursor:pointer;padding:2px 5px;color:rgba(0,255,200,0.4);">−</span>
                </div>
                <div id="yk-body" style="padding:12px 14px;max-height:70vh;overflow:hidden;transition:all 0.3s;">
                    <div id="yk-scene-content"></div>
                    <div style="margin-top:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <span style="color:rgba(0,255,200,0.5);font-size:10px;letter-spacing:2px;font-weight:700;">日志</span>
                            <span id="yk-clear-log" style="color:rgba(255,100,120,0.4);font-size:10px;cursor:pointer;">清空</span>
                        </div>
                        <div id="yk-log" style="max-height:100px;overflow-y:auto;border-radius:6px;padding:6px 8px;font-size:${baseFontSize};line-height:1.5;background:rgba(0,10,20,0.8);border:1px solid rgba(0,255,200,0.08);"></div>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);

            this._el = {
                panel,
                dot: document.getElementById('yk-dot'),
                sceneContent: document.getElementById('yk-scene-content'),
                log: document.getElementById('yk-log'),
                body: document.getElementById('yk-body'),
                toggleBtn: document.getElementById('yk-toggle-btn'),
                clearLog: document.getElementById('yk-clear-log')
            };

            this._bindEvents();
            this._subscribeStatus();
            this._startProgressRefresh();
            this._renderScene('IDLE');
            this._renderLogs();
        },

        _bindEvents() {
            this._el.sceneContent.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = e.target.closest('[data-action]');
                if (!btn || btn.disabled) return;
                const action = btn.getAttribute('data-action');
                if (action === 'complete-all') BatchComplete.start();
                if (action === 'cancel-batch') BatchComplete.stop();
            });

            const toggleCollapse = () => {
                this._collapsed = !this._collapsed;
                if (this._collapsed) {
                    this._el.body.style.maxHeight = '0';
                    this._el.body.style.padding = '0 14px';
                    this._el.body.style.overflow = 'hidden';
                    this._el.toggleBtn.textContent = '+';
                } else {
                    this._el.body.style.maxHeight = '70vh';
                    this._el.body.style.padding = '12px 14px';
                    this._el.body.style.overflow = 'visible';
                    this._el.toggleBtn.textContent = '−';
                }
            };

            document.getElementById('yk-header').addEventListener('click', (e) => {
                if (e.target.id === 'yk-toggle-btn') return;
                if (this._hasMoved && this._hasMoved()) return;
                toggleCollapse();
            });

            this._el.toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCollapse();
            });

            this._el.clearLog.addEventListener('click', (e) => {
                e.stopPropagation();
                StatusCenter.clearLogs();
                this._renderLogs();
            });

            this._enableDrag();
        },

        _subscribeStatus() {
            StatusCenter.subscribe((state, logEntry) => {
                if (state) {
                    this._updateDot(state);
                    this._renderScene(state);
                }
                if (logEntry) this._appendLog(logEntry);
            });
        },

        _updateDot(state) {
            const isBatch = state === 'BATCH';
            this._el.dot.style.background = isBatch ? '#ffc864' : '#6c7086';
            this._el.dot.style.boxShadow = isBatch ? '0 0 12px rgba(255,200,100,0.6)' : 'none';
            this._el.dot.classList.toggle('yk-dot-active', isBatch);
        },

        _renderScene(state) {
            const container = this._el.sceneContent;
            if (!container) return;

            if (state === 'BATCH') {
                const items = document.querySelectorAll('a[href*="/courses/"][href*="/play?taskId="]');
                const total = items.length;
                container.innerHTML = `
                    <div id="yk-scene">
                        <div style="margin-bottom:8px;padding:8px 10px;border-radius:8px;background:rgba(255,200,100,0.06);border:1px solid rgba(255,200,100,0.15);">
                            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:4px;">
                                <span style="color:rgba(255,200,100,0.6);">批量进度</span>
                                <span><span data-batch-done style="color:#ffc864;font-weight:700;">0</span> / <span data-batch-total="${total}" style="color:#ffc864;font-weight:700;">${total}</span></span>
                            </div>
                            <div style="height:6px;border-radius:3px;background:rgba(255,200,100,0.12);overflow:hidden;">
                                <div class="yk-batch-bar-fill" data-batch-bar style="width:0%;height:100%;border-radius:3px;background:linear-gradient(90deg,#ffc864,#ff8800);"></div>
                            </div>
                        </div>
                        <div style="padding:6px 8px;font-size:10px;color:#ffc864;margin-bottom:8px;border-left:3px solid #ffc864;">
                            当前: <span data-batch-name>—</span>
                        </div>
                        <button data-action="cancel-batch" style="width:100%;padding:8px;border:1px solid rgba(255,100,120,0.4);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,100,120,0.08);color:#ff6478;">⏹ 取消批量</button>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div id="yk-scene">
                        <button data-action="complete-all" style="width:100%;padding:12px;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:2px;background:linear-gradient(135deg,#9966ff 0%,#7744ff 100%);color:#fff;box-shadow:0 0 12px rgba(153,102,255,0.3);">
                            ⚡⚡ 完成全部课程
                        </button>
                    </div>
                `;
            }
        },

        _startProgressRefresh() {
            setInterval(() => {
                if (StatusCenter.getState() !== 'BATCH') return;
                const sceneEl = document.getElementById('yk-scene');
                if (!sceneEl) return;

                const totalEl = sceneEl.querySelector('[data-batch-total]');
                const doneEl = sceneEl.querySelector('[data-batch-done]');
                const barEl = sceneEl.querySelector('[data-batch-bar]');
                const nameEl = sceneEl.querySelector('[data-batch-name]');

                if (totalEl && doneEl) {
                    const total = parseInt(totalEl.getAttribute('data-batch-total')) || 1;
                    const done = Math.max(0, total - TaskQueue.remaining());
                    doneEl.textContent = done;
                    if (barEl) barEl.style.width = Math.min(100, (done / total) * 100) + '%';
                }

                if (nameEl) {
                    const logs = StatusCenter.getLogs();
                    for (let i = logs.length - 1; i >= 0; i--) {
                        const m = /\[(\d+)\/\d+\]\s*(.+?)\s*→/.exec(logs[i].msg);
                        if (m) { nameEl.textContent = m[2]; break; }
                    }
                }
            }, 500);
        },

        _enableDrag() {
            const header = document.getElementById('yk-header');
            const panel = this._el.panel;
            let isDragging = false, startX, startY, origX, origY, hasMoved = false;
            const THRESHOLD = 5;

            const onMouseDown = (e) => {
                if (e.button !== 0 || e.target.id === 'yk-toggle-btn') return;
                isDragging = true;
                hasMoved = false;
                const rect = panel.getBoundingClientRect();
                startX = e.clientX; startY = e.clientY;
                origX = rect.left; origY = rect.top;
                panel.style.transition = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX, dy = e.clientY - startY;
                if (!hasMoved && Math.abs(dx) + Math.abs(dy) > THRESHOLD) hasMoved = true;
                if (hasMoved) {
                    panel.style.left = Math.max(0, origX + dx) + 'px';
                    panel.style.top = Math.max(0, origY + dy) + 'px';
                    panel.style.right = 'auto';
                }
            };

            const onMouseUp = () => {
                isDragging = false;
                panel.style.transition = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            header.addEventListener('mousedown', onMouseDown);
            this._hasMoved = () => hasMoved;
        },

        _renderLogs() {
            if (!this._el.log) return;
            this._el.log.innerHTML = StatusCenter.getLogs().map(e => this._formatLogHTML(e)).join('');
            this._el.log.scrollTop = this._el.log.scrollHeight;
        },

        _formatLogHTML(e) {
            const c = { success: '#00ffc8', info: '#8090a0', warn: '#ffc864', error: '#ff6478' }[e.level] || '#8090a0';
            const prefix = { success: '✓ ', warn: '⚠ ', error: '✕ ' }[e.level] || '│ ';
            return '<div style="color:' + c + ';margin-bottom:2px;"><span style="opacity:0.5;">' + e.time + '</span> ' + prefix + e.msg + '</div>';
        },

        _appendLog(entry) {
            if (!this._el.log) return;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = this._formatLogHTML(entry);
            const node = wrapper.firstElementChild;
            if (node) this._el.log.appendChild(node);
            while (this._el.log.children.length > 80) {
                this._el.log.removeChild(this._el.log.firstChild);
            }
            this._el.log.scrollTop = this._el.log.scrollHeight;
        }
    };

    // ================================================================
    // 入口
    // ================================================================
    function init() {
        if (document.getElementById('yk-panel')) return;
        UI.create();
        StatusCenter.log('脚本已加载，点击「完成全部课程」开始', 'success');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
