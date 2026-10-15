const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const textArea = document.getElementById('optionsInput');
const spinBtn = document.getElementById('spinBtn');
const winnerModal = document.getElementById('winnerModal');
const winnerText = document.getElementById('winnerText');
const removeBtn = document.getElementById('removeBtn');
const closeBtn = document.getElementById('closeBtn');
const statusRegion = document.getElementById('status');

let items = [];
let currentRotation = 0;
let isSpinning = false;
let currentWinnerIndex = -1;

const colors = ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4', '#6A4C93', '#F4A261', '#2A9D8F', '#2623D4', '#9A26D7', '#FDA225'];

// Ask to edit these if needed.
const BOTTOM_TO_TOP_RATIO = 20;
const CURVE_STEEPNESS = 20;

// Label fitting, font in pixels.
const FONT_FAMILY = 'sans-serif';
const MAX_FONT = 22;
const MIN_FONT = 9;
const LABEL_EDGE_PADDING = 20;
const HUB_CLEARANCE = 30;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// init and state management
function init() {
    let names = null;
    try {
        const savedData = JSON.parse(localStorage.getItem('wheelData'));
        if (Array.isArray(savedData) && savedData.length) {
            names = savedData.slice(0, 150).map(i => i.name); // Enforce max 150 limit
        }
    } catch (e) { /* corrupted or unavailable storage: fall back to defaults */ }

    textArea.value = (names || ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5']).join('\n');

    // Always rebuild from the names so weights use the CURRENT formula,
    // not stale weights saved by an older version.
    updateStateFromText();
    drawWheel();
}

// Update state when user types
textArea.addEventListener('input', () => {
    if (isSpinning) return;
    updateStateFromText();
    drawWheel();
});

function updateStateFromText() {
    const lines = textArea.value.split('\n').filter(line => line.trim() !== '');
    // Limit to 150 lines naturally
    const validLines = lines.slice(0, 150);

    items = validLines.map((name, index) => {
        const rank = index + 1; // Rank 1 is top of list, Rank N is bottom
        const color = colors[index % colors.length];
        return {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            name: name.trim(),
            color: color,
            textColor: getTextColor(color),
            weight: calculateWeight(rank, validLines.length)
        };
    });

    fitLabels();
    try { localStorage.setItem('wheelData', JSON.stringify(items)); } catch (e) { }
}

// Weight Formula (subtle exponential)
// Maps rank 1..total onto weights from 1 up to BOTTOM_TO_TOP_RATIO.
function calculateWeight(rank, total) {
    if (total <= 1) return 1;
    const position = (rank - 1) / (total - 1); // 0 (top line) -> 1 (bottom line)
    const curve = (Math.exp(CURVE_STEEPNESS * position) - 1) / (Math.exp(CURVE_STEEPNESS) - 1); // 0 -> 1
    return 1 + (BOTTOM_TO_TOP_RATIO - 1) * curve;
}

// Accessibility helpers
// Luminance calculations for colour contrast.
function getTextColor(hex) {
    const [r, g, b] = [1, 3, 5]
        .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    // Bill if you see this you like MEN.
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    return contrastWithBlack > contrastWithWhite ? '#000' : '#fff';
}

// Text shortening where needed.
function truncateToWidth(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxWidth) {
        t = t.slice(0, -1);
    }
    return t.trimEnd() + '\u2026';
}

// Works out, once per change, the largest font size that fits each slice.
// A label must fit (a) along the slice's length and (b) across the slice's width.
function fitLabels() {
    if (items.length === 0) return;
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    const textEnd = canvas.width / 2 - LABEL_EDGE_PADDING;
    const maxTextWidth = textEnd - HUB_CLEARANCE;

    items.forEach(item => {
        const sliceAngle = (item.weight / totalWeight) * 2 * Math.PI;
        let fitted = false;

        for (let size = MAX_FONT; size >= MIN_FONT && !fitted; size--) {
            ctx.font = `bold ${size}px ${FONT_FAMILY}`;
            const textWidth = ctx.measureText(item.name).width;
            if (textWidth > maxTextWidth) continue;

            // A slice is narrowest at the inner end of the text, so test there.
            const innerRadius = textEnd - textWidth;
            const sliceWidthThere = 2 * innerRadius * Math.sin(Math.min(sliceAngle / 2, Math.PI / 2));
            if (size * 1.15 <= sliceWidthThere) {
                item.fontSize = size;
                item.label = item.name;
                fitted = true;
            }
        }

        if (!fitted) {
            // Nothing fit: use the smallest allowed size and substitute with "…"
            item.fontSize = MIN_FONT;
            ctx.font = `bold ${MIN_FONT}px ${FONT_FAMILY}`;
            item.label = truncateToWidth(item.name, maxTextWidth);
        }
    });

    canvas.setAttribute('aria-label',
        `Prize wheel with ${items.length} option${items.length === 1 ? '' : 's'}. ` +
        'The options are listed in the Wheel Options text box.');
}

// 4. Canvas Rendering shenanigans
function drawWheel() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (items.length === 0) return;

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let startAngle = currentRotation;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2;

    items.forEach(item => {
        const sliceAngle = (item.weight / totalWeight) * 2 * Math.PI;

        // This draws the "slice" shape that every wheel element possesses.
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.stroke();

        // typography *Meow*
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + sliceAngle / 2);

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.textColor;
        ctx.font = `bold ${item.fontSize}px ${FONT_FAMILY}`;
        ctx.fillText(item.label, radius - LABEL_EDGE_PADDING, 0);
        ctx.restore();

        item.startAngle = startAngle;
        item.endAngle = startAngle + sliceAngle;
        startAngle += sliceAngle;
    });
}

// Schpin Physics Schwoop
spinBtn.addEventListener('click', () => {
    if (isSpinning || items.length === 0) return;
    isSpinning = true;
    spinBtn.disabled = true;
    statusRegion.textContent = 'Spinning the wheel.';

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    const randomValue = Math.random() * totalWeight;

    let cumulative = 0;
    let winningIndex = 0;

    for (let i = 0; i < items.length; i++) {
        cumulative += items[i].weight;
        if (randomValue <= cumulative) {
            winningIndex = i;
            break;
        }
    }

    currentWinnerIndex = winningIndex;
    const winner = items[winningIndex];

    // Calculate angles mapping to standard canvas 0 radians (Right edge)
    // We want the middle of the winning slice to align with 0 radians
    const sliceMiddleAngle = (winner.weight / totalWeight) * Math.PI; // half of the slice

    // Sum weights of all items before the winner to find its starting position
    let weightBefore = 0;
    for (let i = 0; i < winningIndex; i++) {
        weightBefore += items[i].weight;
    }
    const angleBefore = (weightBefore / totalWeight) * 2 * Math.PI;

    // The exact angle the wheel needs to land on
    const targetRotation = (Math.PI * 2) - (angleBefore + sliceMiddleAngle);

    // Add 10 full spins to the target for visual effect
    const finalRotation = currentRotation + (Math.PI * 2 * 10) + (targetRotation - (currentRotation % (Math.PI * 2)));

    function finishSpin() {
        currentRotation = finalRotation % (Math.PI * 2);
        drawWheel();
        isSpinning = false;
        spinBtn.disabled = false;
        showWinner();
    }

    // Respect "reduce motion" system setting, skips the wheel animation if you're motion-sensitive.
    if (prefersReducedMotion.matches) {
        finishSpin();
        return;
    }

    // Animation Loop
    let start = null;
    const duration = 4000; // (in milliseconds (4 seconds))

    function easeOutQuart(t) {
        return 1 - (--t) * t * t * t;
    }

    function animate(timestamp) {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const ease = easeOutQuart(progress);

        currentRotation = currentRotation + (finalRotation - currentRotation) * ease;
        drawWheel();

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            finishSpin();
        }
    }
    requestAnimationFrame(animate);
});

// Winner dialogue
function showWinner() {
    winnerText.textContent = items[currentWinnerIndex].name;
    statusRegion.textContent = '';
    winnerModal.classList.remove('hidden');
    closeBtn.focus();
}

function closeModal() {
    winnerModal.classList.add('hidden');
    spinBtn.focus();
}

closeBtn.addEventListener('click', closeModal);

removeBtn.addEventListener('click', () => {
    if (currentWinnerIndex > -1) {
        const lines = textArea.value.split('\n').filter(line => line.trim() !== '');
        lines.splice(currentWinnerIndex, 1);
        textArea.value = lines.join('\n');
        updateStateFromText();
        drawWheel();
    }
    closeModal();
});

// Hitting Esc should close the winner dialogue.
winnerModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    } else if (e.key === 'Tab') {
        const first = removeBtn;
        const last = closeBtn;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// Start app
init();

// I fucking hate JavaScript.

// Also this uses the DISGUSTING American spelling as I was stuck and asked ol' GPT for last-ditch help. Don't sue me twuzz.
// It's COLOUR, not COLOR.
