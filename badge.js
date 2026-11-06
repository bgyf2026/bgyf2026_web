// ================= EVENT BADGE (shared by index.html and admin.html) =================
// 2.25 x 3.5 in at 300 dpi = 675 x 1050 px, drawn in the browser.
const BADGE_W = 675;
const BADGE_H = 1050;
// Role bands avoid red, blue, yellow and green: those are the Youth Delegate team colours.
const ROLE_COLORS = {
    'Youth Delegate': ['#ee7a22', '#1c1c1c'],
    'Pastor': ['#1c1c1c', '#f6cb4c'],
    'BGYF Officer': ['#6a3d9a', '#f6f1dd'],
    'Workers': ['#7a4a1f', '#f6f1dd'],
    'Church Member/Volunteer': ['#5f6b73', '#f6f1dd'],
};
const TEAM_COLORS = {
    Red: ['#c62828', '#fffaf0'],
    Blue: ['#1565c0', '#fffaf0'],
    Yellow: ['#f6c624', '#1c1c1c'],
    Green: ['#2e7d32', '#fffaf0'],
};

function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Largest font size (down to min) at which text fits maxW; returns lines (1 or 2). */
function fitText(ctx, text, weight, max, min, maxW) {
    for (let size = max; size >= min; size -= 2) {
        ctx.font = `${weight} ${size}px Outfit, system-ui, sans-serif`;
        if (ctx.measureText(text).width <= maxW) return { size, lines: [text] };
    }
    // two lines: split at the space that balances the lines best
    const words = text.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' ');
        const b = words.slice(i).join(' ');
        for (let size = max; size >= min; size -= 2) {
            ctx.font = `${weight} ${size}px Outfit, system-ui, sans-serif`;
            if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= maxW) {
                if (!best || size > best.size) best = { size, lines: [a, b] };
                break;
            }
        }
    }
    if (best) return best;
    ctx.font = `${weight} ${min}px Outfit, system-ui, sans-serif`;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return { size: min, lines: [t + '…'] };
}

function drawBadge(r, photo) {
    const c = document.createElement('canvas');
    c.width = BADGE_W;
    c.height = BADGE_H;
    const ctx = c.getContext('2d');
    const W = BADGE_W;
    const cx = W / 2;

    // card
    ctx.fillStyle = '#f6f1dd';
    ctx.fillRect(0, 0, W, BADGE_H);

    // header: sunset gradient + halftone dots, like the poster
    const HEAD = 430;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, HEAD);
    g.addColorStop(0, '#e8641c');
    g.addColorStop(0.55, '#ee7a22');
    g.addColorStop(1, '#f6b23b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HEAD);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, HEAD);
    ctx.clip();
    for (let y = 6; y < HEAD; y += 14) {
        for (let x = (y / 14) % 2 ? 13 : 6; x < W; x += 14) {
            const d = Math.hypot(x - W * 0.72, y - 120) / 520;   // dots fade out from the "sun"
            const rad = 3.2 * Math.max(0, 1 - d);
            if (rad < 0.4) continue;
            ctx.fillStyle = 'rgba(246, 203, 76, 0.55)';
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    // lanyard slot
    ctx.fillStyle = 'rgba(28, 28, 28, 0.18)';
    rrect(ctx, cx - 70, 34, 140, 26, 13);
    ctx.fill();

    ctx.fillStyle = '#fffaf0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 21px Outfit, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
    ctx.fillText('BICOL GRACE YOUTH FELLOWSHIP', cx, 108);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const title = fitText(ctx, 'NO TURNING', 800, 90, 64, W - 110);
    ctx.font = `800 ${title.size}px Outfit, system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowOffsetY = 4;
    ctx.shadowBlur = 8;
    ctx.fillText('NO TURNING', cx, 200);
    ctx.fillText('BACK', cx, 288);
    ctx.shadowColor = 'transparent';
    ctx.font = '600 24px Outfit, system-ui, sans-serif';
    ctx.fillStyle = '#1c1c1c';
    ctx.fillText('DEC 27–30, 2026  ·  BGYF 2026', cx, 334);

    // photo, framed, overlapping the header
    const PW = 268, PH = 357, PX = cx - PW / 2, PY = 362;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fffaf0';
    rrect(ctx, PX - 10, PY - 10, PW + 20, PH + 20, 22);
    ctx.fill();
    ctx.restore();
    ctx.save();
    rrect(ctx, PX, PY, PW, PH, 14);
    ctx.clip();
    const iw = photo.naturalWidth, ih = photo.naturalHeight;
    const scale = Math.max(PW / iw, PH / ih);   // cover the frame, crop the overflow
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(photo, PX + (PW - dw) / 2, PY + (PH - dh) * 0.35, dw, dh);
    ctx.restore();

    // name (1 or 2 lines, shrinks to fit)
    ctx.fillStyle = '#1c1c1c';
    let name = fitText(ctx, String(r.full_name).toUpperCase(), 800, 58, 36, W - 80);
    if (name.lines.length === 2) name = fitText(ctx, String(r.full_name).toUpperCase(), 800, 44, 32, W - 80);
    ctx.font = `800 ${name.size}px Outfit, system-ui, sans-serif`;
    const two = name.lines.length === 2;
    let y = two ? 782 : 796;
    name.lines.forEach((line, i) => ctx.fillText(line, cx, y + i * (name.size + 6)));
    y += (name.lines.length - 1) * (name.size + 6);

    // church
    const ch = fitText(ctx, String(r.local_church), 500, 30, 22, W - 80);
    ctx.font = `500 ${ch.size}px Outfit, system-ui, sans-serif`;
    ctx.fillStyle = '#6d6658';
    ctx.fillText(ch.lines[0], cx, y + (two ? 40 : 46));

    // role band
    const team = r.team && TEAM_COLORS[r.team] ? r.team : '';
    const [bg, fg] = team ? TEAM_COLORS[team] : ROLE_COLORS[r.role] || ['#ee7a22', '#1c1c1c'];
    const BAND = 900;
    ctx.fillStyle = bg;
    ctx.fillRect(0, BAND, W, 76);
    ctx.fillStyle = fg;
    const bandText = team ? `${String(r.role).toUpperCase()} · ${team.toUpperCase()} TEAM` : String(r.role).toUpperCase();
    const role = fitText(ctx, bandText, 800, 40, 24, W - 60);
    ctx.font = `800 ${role.size}px Outfit, system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText(role.lines[0], cx, BAND + 52);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    // road strip with the registration no.
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, BAND + 76, W, BADGE_H - BAND - 76);
    ctx.fillStyle = '#f6f1dd';
    ctx.font = '600 18px Outfit, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillText('REG. NO.', cx - 120, BAND + 122);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = '700 38px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(String(r.reg_code), cx + 60, BAND + 125);
    ctx.fillStyle = 'rgba(246, 241, 221, 0.6)';
    for (let x = 18; x < W; x += 44) ctx.fillRect(x, BADGE_H - 14, 26, 4);   // lane markings

    return c;
}
