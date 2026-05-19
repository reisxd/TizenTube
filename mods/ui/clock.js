import { configChangeEmitter, configRead } from '../config.js';

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'enableClock') {
        toggleClock(e.detail.value);
    }
});

let actualClock;

function toggleClock(value) {
    const existingClock = document.getElementById('tizentube-clock');
    if (value && existingClock) return;
    if (!value && existingClock) {
        existingClock.remove();
        return;
    }
    if (!value && !existingClock) {
        return;
    } else {
        const clock = document.createElement('div');
 
        clock.id = 'tizentube-clock';
        clock.style.height = '45rem';
        clock.style.width = '80rem';
        clock.style.position = 'absolute';
        clock.style.top = '50%';
        clock.style.left = '50%';
        clock.style.marginTop = '-22.5rem';
        clock.style.marginLeft = '-40rem';

        actualClock = document.createElement('div');

        actualClock.style.position = 'absolute';
        actualClock.style.zIndex = '9999';
        actualClock.style.right = '5%';
        actualClock.style.top = '2%';
        actualClock.style.fontSize = '1.5em';
        clock.appendChild(actualClock);
        document.body.appendChild(clock);

        function updateClock() {
            const now = new Date();
            const is12HourFormat = configRead('isClock12HourFormat');
            const secondsEnabled = configRead('clockShowSeconds');

            let hours = now.getHours();
            if (is12HourFormat) {
                hours = hours % 12 || 12;
            }

            hours = hours.toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            const seconds = now.getSeconds().toString().padStart(2, '0');
            actualClock.textContent = `${hours}:${minutes}${secondsEnabled ? `:${seconds}` : ''}${is12HourFormat ? (now.getHours() >= 12 ? ' PM' : ' AM') : ''}`;
        }

        updateClock();
        setInterval(updateClock, 1000);
    }
}

toggleClock(configRead('enableClock'));