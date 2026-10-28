document.querySelector('#demoBtn').click();
await new Promise(r => setTimeout(r, 1500));
const img = document.querySelector('#artImg');
const crop = document.querySelector('#crop');
const ir = img.getBoundingClientRect();
const cr = crop.getBoundingClientRect();
const net = window.netDims ? window.netDims() : null;
return {
  img: { w: Math.round(ir.width), h: Math.round(ir.height), nat: [img.naturalWidth, img.naturalHeight] },
  crop: { w: Math.round(cr.width), h: Math.round(cr.height), x: Math.round(cr.left - ir.left), y: Math.round(cr.top - ir.top) },
  cropAspect: +(cr.width / cr.height).toFixed(3),
  targetAspect: +(199 / 95).toFixed(3),
  net,
  fx: window.S ? S.fx : null, fy: window.S ? S.fy : null,
  cropStyle: { w: crop.style.width, h: crop.style.height, left: crop.style.left, top: crop.style.top },
};
