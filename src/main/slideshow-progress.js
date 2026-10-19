'use strict';

function createSlideshowProgressRange(report, start, end) {
    let last = -1;
    return percent => {
        const local = Math.max(0, Math.min(100, Number(percent) || 0));
        // Only explicit completion may reach the end of a stage.
        const value = Math.floor(start + (end - start) * local / 100);
        if (value <= last) return;
        last = value;
        report(value);
    };
}

module.exports = { createSlideshowProgressRange };
