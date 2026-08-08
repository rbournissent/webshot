/**
 * WebShot - Interactive Canvas Cropper
 * Handles 8-point resize handles, dragging, aspect ratios, and visual shading backdrops.
 */

class InteractiveCropper {
  constructor(options) {
    this.container = options.container; // cropperOverlay
    this.cropBox = options.cropBox;
    this.shades = options.shades; // { top, bottom, left, right }
    this.badge = options.badge;
    this.onCropChange = options.onCropChange || (() => {});
    
    this.canvasWidth = 100;
    this.canvasHeight = 100;
    this.zoom = 1;
    
    // Crop coordinates in unscaled canvas pixels
    this.crop = { x: 0, y: 0, width: 100, height: 100 };
    this.aspectRatio = null; // null for free, or numeric float like 16/9
    this.aspectRatioName = 'free';

    this.isDragging = false;
    this.isResizing = false;
    this.activeHandle = null;
    this.dragStart = { x: 0, y: 0 };
    this.initialCrop = { x: 0, y: 0, width: 100, height: 100 };

    this.bindEvents();
  }

  /**
   * Initializes cropper to cover the ENTIRE screenshot by default
   */
  init(canvasWidth, canvasHeight, zoom) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.zoom = zoom;

    // Default: Entire full screenshot
    this.aspectRatio = null;
    this.aspectRatioName = 'free';
    this.setCrop(0, 0, canvasWidth, canvasHeight);
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this.render();
  }

  setCrop(x, y, width, height, notify = true) {
    const minSize = 20;
    width = Math.max(minSize, Math.min(this.canvasWidth, Math.round(width)));
    height = Math.max(minSize, Math.min(this.canvasHeight, Math.round(height)));
    x = Math.max(0, Math.min(this.canvasWidth - width, Math.round(x)));
    y = Math.max(0, Math.min(this.canvasHeight - height, Math.round(y)));

    this.crop = { x, y, width, height };
    this.render();

    if (notify) {
      this.onCropChange(this.getCrop());
    }
  }

  getCrop() {
    return { ...this.crop };
  }

  setAspectRatio(ratioStr) {
    this.aspectRatioName = ratioStr;
    if (ratioStr === 'free') {
      this.aspectRatio = null;
    } else {
      const [w, h] = ratioStr.split(':').map(Number);
      if (w && h) {
        this.aspectRatio = w / h;
        // Adjust current crop to fit the aspect ratio within canvas bounds
        let newW = this.crop.width;
        let newH = Math.round(newW / this.aspectRatio);

        if (newH > this.canvasHeight) {
          newH = this.canvasHeight;
          newW = Math.round(newH * this.aspectRatio);
        }
        if (newW > this.canvasWidth) {
          newW = this.canvasWidth;
          newH = Math.round(newW / this.aspectRatio);
        }

        const newX = Math.max(0, Math.min(this.canvasWidth - newW, this.crop.x));
        const newY = Math.max(0, Math.min(this.canvasHeight - newH, this.crop.y));

        this.setCrop(newX, newY, newW, newH);
      }
    }
  }

  selectAll() {
    this.aspectRatio = null;
    this.aspectRatioName = 'free';
    this.setCrop(0, 0, this.canvasWidth, this.canvasHeight);
  }

  centerCrop() {
    const x = Math.round((this.canvasWidth - this.crop.width) / 2);
    const y = Math.round((this.canvasHeight - this.crop.height) / 2);
    this.setCrop(x, y, this.crop.width, this.crop.height);
  }

  toggleGrid(show) {
    if (show) {
      this.cropBox.classList.remove('no-grid');
    } else {
      this.cropBox.classList.add('no-grid');
    }
  }

  bindEvents() {
    // Mouse down on crop box (drag) or handles (resize)
    this.cropBox.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const handle = e.target.closest('.crop-handle');
      if (handle) {
        this.isResizing = true;
        this.activeHandle = handle.dataset.handle;
      } else {
        this.isDragging = true;
      }

      this.dragStart = { x: e.clientX, y: e.clientY };
      this.initialCrop = { ...this.crop };

      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('mouseup', this.onMouseUp);
    });

    this.onMouseMove = (e) => {
      if (!this.isDragging && !this.isResizing) return;

      const deltaX = (e.clientX - this.dragStart.x) / this.zoom;
      const deltaY = (e.clientY - this.dragStart.y) / this.zoom;

      if (this.isDragging) {
        let newX = this.initialCrop.x + deltaX;
        let newY = this.initialCrop.y + deltaY;
        this.setCrop(newX, newY, this.crop.width, this.crop.height);
      } else if (this.isResizing) {
        this.handleResize(deltaX, deltaY);
      }
    };

    this.onMouseUp = () => {
      this.isDragging = false;
      this.isResizing = false;
      this.activeHandle = null;
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('mouseup', this.onMouseUp);
    };
  }

  handleResize(deltaX, deltaY) {
    let { x, y, width, height } = this.initialCrop;
    const minSize = 20;

    switch (this.activeHandle) {
      case 'e':
        width = Math.max(minSize, Math.min(this.canvasWidth - x, width + deltaX));
        if (this.aspectRatio) {
          height = Math.min(this.canvasHeight - y, Math.round(width / this.aspectRatio));
          width = Math.round(height * this.aspectRatio);
        }
        break;

      case 'w': {
        const maxX = x + width - minSize;
        const newX = Math.max(0, Math.min(maxX, x + deltaX));
        width = width + (x - newX);
        x = newX;
        if (this.aspectRatio) {
          height = Math.min(this.canvasHeight - y, Math.round(width / this.aspectRatio));
          width = Math.round(height * this.aspectRatio);
        }
        break;
      }

      case 's':
        height = Math.max(minSize, Math.min(this.canvasHeight - y, height + deltaY));
        if (this.aspectRatio) {
          width = Math.min(this.canvasWidth - x, Math.round(height * this.aspectRatio));
          height = Math.round(width / this.aspectRatio);
        }
        break;

      case 'n': {
        const maxY = y + height - minSize;
        const newY = Math.max(0, Math.min(maxY, y + deltaY));
        height = height + (y - newY);
        y = newY;
        if (this.aspectRatio) {
          width = Math.min(this.canvasWidth - x, Math.round(height * this.aspectRatio));
          height = Math.round(width / this.aspectRatio);
        }
        break;
      }

      case 'se':
        width = Math.max(minSize, Math.min(this.canvasWidth - x, width + deltaX));
        if (this.aspectRatio) {
          height = Math.min(this.canvasHeight - y, Math.round(width / this.aspectRatio));
          width = Math.round(height * this.aspectRatio);
        } else {
          height = Math.max(minSize, Math.min(this.canvasHeight - y, height + deltaY));
        }
        break;

      case 'sw': {
        const maxX = x + width - minSize;
        const newX = Math.max(0, Math.min(maxX, x + deltaX));
        width = width + (x - newX);
        x = newX;
        if (this.aspectRatio) {
          height = Math.min(this.canvasHeight - y, Math.round(width / this.aspectRatio));
          width = Math.round(height * this.aspectRatio);
        } else {
          height = Math.max(minSize, Math.min(this.canvasHeight - y, height + deltaY));
        }
        break;
      }

      case 'ne': {
        width = Math.max(minSize, Math.min(this.canvasWidth - x, width + deltaX));
        if (this.aspectRatio) {
          const newH = Math.round(width / this.aspectRatio);
          const newY = Math.max(0, y + height - newH);
          height = y + height - newY;
          width = Math.round(height * this.aspectRatio);
          y = newY;
        } else {
          const maxY = y + height - minSize;
          const newY = Math.max(0, Math.min(maxY, y + deltaY));
          height = height + (y - newY);
          y = newY;
        }
        break;
      }

      case 'nw': {
        const maxX = x + width - minSize;
        const newX = Math.max(0, Math.min(maxX, x + deltaX));
        width = width + (x - newX);
        x = newX;

        if (this.aspectRatio) {
          const newH = Math.round(width / this.aspectRatio);
          const newY = Math.max(0, y + height - newH);
          height = y + height - newY;
          width = Math.round(height * this.aspectRatio);
          y = newY;
        } else {
          const maxY = y + height - minSize;
          const newY = Math.max(0, Math.min(maxY, y + deltaY));
          height = height + (y - newY);
          y = newY;
        }
        break;
      }
    }

    this.setCrop(x, y, width, height);
  }

  render() {
    const scaledX = this.crop.x * this.zoom;
    const scaledY = this.crop.y * this.zoom;
    const scaledW = this.crop.width * this.zoom;
    const scaledH = this.crop.height * this.zoom;
    const totalW = this.canvasWidth * this.zoom;
    const totalH = this.canvasHeight * this.zoom;

    // Position Crop Box
    this.cropBox.style.left = `${scaledX}px`;
    this.cropBox.style.top = `${scaledY}px`;
    this.cropBox.style.width = `${scaledW}px`;
    this.cropBox.style.height = `${scaledH}px`;

    // Position 4 Shading Rectangles around the box
    // Top
    this.shades.top.style.top = '0px';
    this.shades.top.style.left = '0px';
    this.shades.top.style.width = `${totalW}px`;
    this.shades.top.style.height = `${scaledY}px`;

    // Bottom
    this.shades.bottom.style.top = `${scaledY + scaledH}px`;
    this.shades.bottom.style.left = '0px';
    this.shades.bottom.style.width = `${totalW}px`;
    this.shades.bottom.style.height = `${Math.max(0, totalH - (scaledY + scaledH))}px`;

    // Left
    this.shades.left.style.top = `${scaledY}px`;
    this.shades.left.style.left = '0px';
    this.shades.left.style.width = `${scaledX}px`;
    this.shades.left.style.height = `${scaledH}px`;

    // Right
    this.shades.right.style.top = `${scaledY}px`;
    this.shades.right.style.left = `${scaledX + scaledW}px`;
    this.shades.right.style.width = `${Math.max(0, totalW - (scaledX + scaledW))}px`;
    this.shades.right.style.height = `${scaledH}px`;

    // Badge text
    const aspectTag = this.aspectRatioName !== 'free' ? ` (${this.aspectRatioName})` : '';
    this.badge.textContent = `${this.crop.width} × ${this.crop.height} px${aspectTag}`;
  }
}
