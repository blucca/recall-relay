/** A temporary, device-local view of the owner's image. Domain state keeps readiness only. */
export function createLabelPhoto() {
  let current = null;
  let generation = 0;

  function clear() {
    generation++;
    if (current) URL.revokeObjectURL(current.url);
    current = null;
  }

  async function select(file) {
    if (!file) return current;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      throw new Error('Choose a JPEG, PNG, or WebP label photo up to 20 MB.');
    }
    const version = ++generation;
    const url = URL.createObjectURL(file);
    try {
      const preview = new Image();
      preview.src = url;
      await preview.decode();
      if (version !== generation) { URL.revokeObjectURL(url); return current; }
      if (current) URL.revokeObjectURL(current.url);
      current = { url, name: file.name || 'product-label.jpg' };
      return current;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Open this photo as a JPEG, PNG, or WebP image so the label can be viewed here.');
    }
  }

  return { select, clear, get current() { return current; } };
}
