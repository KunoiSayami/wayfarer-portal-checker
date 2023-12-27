// ==UserScript==
// @name         Wayfarer check submitted portal
// @version      1.0.0-rc.1
// @description  Check is friend nominate portal
// @match        https://wayfarer.nianticlabs.com/*
// @author       KunoiSayami
// ==/UserScript==
/* eslint-env es6 */
/* eslint no-var: "error" */
'use strict';

(function () {

    const CHECKER_CONFIG_KEY = "wf-checker-config";
    const WAYFARER_EXPORTER_KEY = "wayfarerexporter-url";

    const INDEXDB_VERSION = 1;
    const INDEXDB_NAME = 'wf-checker';

    const ALLOWED_STATUS = Array.from(["submitted", "voting", "appealed", "held"]);
    let server_config = localStorage.getItem(CHECKER_CONFIG_KEY);

    // Clear old configure
    let oldConfig = localStorage.getItem('checker-config');
    if (oldConfig !== null) {
        localStorage.removeItem('checker-config');
        server_config = oldConfig;
        localStorage.setItem(CHECKER_CONFIG_KEY, server_config);
    }

    let tryNumber = 15;

    let global_button, global_status;

    class DBConnection {
        constructor() {
            let request = window.indexedDB.open(INDEXDB_NAME, INDEXDB_VERSION);

            request.onsuccess = event => {
                this.conn = event.target.result;
                console.log("Database connected!");
            }

            request.onupgradeneeded = event => {
                this.conn = event.target.result;
                let objectStore;
                if (!this.conn.objectStoreNames.contains('portals')) {
                    objectStore = this.conn.createObjectStore('portals', { keyPath: 'lat_lng' });
                }
                objectStore.createIndex('title', 'title', { unique: false });
                objectStore.createIndex('nickname', 'nickname', { unique: false });
                objectStore.createIndex('status', 'status', { unique: false });
                objectStore.createIndex('marked', 'marked', { unique: false });
            }
        }

        add(portal) {
            let request = this.conn.transaction(['portals'], 'readwrite')
                .objectStore('portals')
                .add({
                    nickname: portal.nickname,
                    lat: portal.lat,
                    lng: portal.lng,
                    title: portal.title,
                    status: portal.status,
                    lat_lng: portal.lat + portal.lng,
                    marked: false,
                });

            request.onsuccess = _event => {
                //console.log('Write ', portal.title, ' success');
            };

            request.onerror = _event => {
                console.log('Write ', portal.title, ' failure');
            };
        }

        select(lat, lng, callback) {
            let transaction = this.conn.transaction(['portals']);
            let objectStore = transaction.objectStore('portals');
            let request = objectStore.get(lat + lng);

            request.onerror = _event => {
                console.log("Select", lat + lng, " failure");
            }

            request.onsuccess = _event => {
                /* if (request.result) {
                    console.log("Get result " + request.result);
                } else {
                    console.log("Not found ", lat + lng);
                } */
                //console.log(request);
                callback(request.result);
            }
        }

        update(fields) {
            let request = this.conn.transaction(['portals'], 'readwrite')
                .objectStore('portals')
                .put(fields);

            /* request.onsuccess = _event => {
                console.log('Updated');
            }; */

            request.onerror = _event => {
                console.log("Select", lat + lng, " failure");
            }
        }

        clearNoMarked() {

            let objectStore = this.conn.transaction(['portals'], 'readwrite').objectStore('portals');

            objectStore.openCursor().onsuccess = event => {
                let cursor = event.target.result;

                if (cursor !== null) {
                    let portal = cursor.value;
                    if (portal.marked === false) {
                        /* objectStore.delete(cursor.primaryKey).onsuccess = _event => {
                            console.log("Delete => ", portal);
                        };
                        console.log("Delete => ", portal);*/
                    } else {
                        portal.marked = false;
                        objectStore.put(portal);
                    }
                    cursor.continue();
                }
            }
        }

    };


    let db = new DBConnection();

    if (server_config !== null) {
        server_config = JSON.parse(server_config);
        if (server_config.last_update === undefined) {
            server_config.last_update = 0;
        }
    } else {
        server_config = { url: '', last_update: 0 };
    }

    if (server_config === null || server_config.url.length === 0) {
        // try read from wayfarer importer
        let exporter_url = localStorage.getItem(WAYFARER_EXPORTER_KEY);
        if (exporter_url === null || exporter_url.length === 0) {
            let url = window.prompt("Please input wayfarer remote url");
            server_config.url = url;
        } else {
            server_config.url = exporter_url;
        }
        localStorage.setItem(CHECKER_CONFIG_KEY, JSON.stringify(server_config));
    }

    updateRemote(server_config.url);
    addCss();

    (function (open) {
        XMLHttpRequest.prototype.open = function (method, url) {
            if (url === '/api/v1/vault/review') {
                if (method === 'GET') {
                    this.addEventListener('load', parseCandidate, false);
                }
                if (method === 'POST') {
                    hideButton();
                }
            }
            open.apply(this, arguments)
        }
    })(XMLHttpRequest.prototype.open);


    function updateRemote(url, force = false) {
        // If last update < 600, skip this update
        if (!force && server_config !== undefined && server_config.last_update !== undefined &&
            (new Date().getTime() - server_config.last_update) / 1000 < 600) {
            return;
        }

        console.info('Starting update remote portals');

        const fetchOptions = {
            method: 'GET',
        };
        fetch(url, fetchOptions).then(response => {
            return response.text();
        })
            .then((data) => {
                //console.log(data);
                return JSON.parse(data);
            })
            .then(all_data => {
                //console.log(all_data);
                const allowed_portal = all_data.filter(portal =>
                    ALLOWED_STATUS.some(v => v === portal.status)
                );
                const candidates = {};
                allowed_portal.forEach(p => {
                    candidates[p.lat + p.lng] = {
                        nickname: p.nickname,
                        lat: p.lat,
                        lng: p.lng,
                        title: p.title,
                        status: p.status,
                    }
                });
                //console.log(allowed_portal);
                performanceUpdatePortal(allowed_portal);
                return allowed_portal;
            });
    }

    function performanceUpdatePortal(portals) {
        for (let portal of portals) {
            db.select(portal.lat, portal.lng, result => {
                //console.log(result);
                if (result === undefined || result === null) {
                    db.add(portal, true);
                } else {
                    result.marked = true;
                    db.update(result);
                }
            });

        }
        setTimeout(() => {
            db.clearNoMarked();
            server_config.last_update = new Date().getTime();
            localStorage.setItem(CHECKER_CONFIG_KEY, JSON.stringify(server_config));
            console.log("Database updated");
        }, 500);
    }


    function parseCandidate(e) {
        try {
            const response = this.response;
            const json = JSON.parse(response);
            if (!json) {
                console.log(response);
                alert('Failed to parse response from Wayfarer');
                return;
            }
            // ignore if it's related to captchas
            if (json.captcha) {
                return;
            }

            if (json.code !== 'OK') {
                return;
            }

            let candidate = json.result;
            if (!candidate) {
                console.log(json);
                alert("Wayfarer's response didn't include a candidate.");
                return;
            }
            addButton(candidate);
        } catch (e) {
            console.log(e); // eslint-disable-line no-console
        }
    }


    function createButton(ref) {
        if (!global_button) {
            const div = document.createElement('div');
            div.className = 'wayfarer_checker';
            const button = document.createElement('button');
            button.className = '';
            button.innerHTML = `run`;

            const select = document.createElement('select');
            select.title = 'Select options';
            const engines = [
                { name: 'update_remote', title: 'Update remote' },
                { name: 'set_url', title: 'Set url' }
            ];

            // WIP
            select.innerHTML = engines
                .map(
                    (item) =>
                        `<option value="${item.name}" ${item.name === 'set_url' ? 'selected' : ''
                        }>${item.title}</option>`
                )
                .join('');

            div.appendChild(select);
            div.innerHTML += '&nbsp;';
            div.appendChild(button);
            div.appendChild(document.createElement("br"));
            let status = document.createElement("span");
            status.innerHTML = 'No found';
            status.id = 'checker_status';
            global_status = status;
            div.appendChild(status);
            global_button = div;
        }

        const container = ref.parentNode.parentNode;
        if (!container.contains(global_button)) {
            container.appendChild(global_button);
        }
    }

    function addButton(candidate) {

        const ref = document.querySelector('wf-logo');

        if (!ref) {
            if (tryNumber === 0) {
                document
                    .querySelector('body')
                    .insertAdjacentHTML(
                        'afterBegin',
                        `<div class="alert alert-danger">
                            <strong>
                                <span class="glyphicon glyphicon-remove"></span>
                                Wayfarer portal checker initialization failed, refresh page
                            </strong>
                        </div>`
                    );
                return;
            }
            setTimeout(addButton, 1000);
            tryNumber--;
            return;
        }

        let text = '';
        if (candidate.type === 'NEW') {
            text = candidate.lnt + candidate.lng;
        }

        if (text !== '') {
            createButton(ref);
            //const button = global_button.querySelector('a');

            // Check is found friend portal
            db.select(candidate.lat, candidate.lng, result => {
                console.log('Query =>', candidate.lat, ',', candidate.lng, ', result => ' + result);
                if (result === null || result === undefined) {
                    global_status.classList.remove('wayfarer_checker_found');
                    return;
                }
                global_status.innerHTML = 'Founded';
                global_status.classList.add('wayfarer_checker_found');
            });

            //link.href = getTranslatorLink() + encodeURIComponent(text);
            global_button.classList.add('wayfarer_checker__visible');
        }

    }

    function hideButton() {
        global_button.classList.remove('wayfarer_checker__visible');
    }


    function addCss() {
        const css = `
            .wayfarer_checker {
                color: #333;
                margin-left: 2em;
                padding-top: 0.3em;
                text-align: center;
                display: none;
            }
            .wayfarer_checker__visible {
                display: inline;
            }
            .wayfarer_checker svg {
                width: 24px;
                height: 24px;
                filter: none;
                fill: currentColor;
                margin: 0 auto;
            }
            .dark .wayfarer_checker {
                color: #ddd;
            }
            .dark .wayfarer_checker select,
            .dark .wayfarer_checker option {
                background: #000;
            }
            .wayfarer_checker span {
                font-size: large;
                color: red;
            }
            .wayfarer_checker_found {
                color: green !important;
            }
            `;
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        document.querySelector('head').appendChild(style);
    }


})();
