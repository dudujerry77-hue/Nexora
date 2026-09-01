'use client';

import { useRef, useState } from 'react';
import { X, UploadCloud, Link as LinkIcon, Trash2, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { useToast } from '@/components/Toast';

const MAX_IMAGE_BYTES = 1_500_000; // ~1.5MB per image, kept small for a SQLite TEXT column
const MAX_IMAGES = 8;

export interface ProductFormVariant {
  id?: string;
  name: string;
  sku: string;
  price: string;
  quantity: string;
}

export interface EditableProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  status: string;
  images: string[];
  categories: string[];
  variants: { id: string; name: string; sku: string | null; price: number | null; quantity: number }[];
  inventory: { quantity: number; lowStockThreshold: number } | null;
}

interface ProductFormModalProps {
  storeId: string;
  product?: EditableProduct | null;
  onClose: () => void;
  onSaved: () => void;
}

function emptyVariant(): ProductFormVariant {
  return { name: '', sku: '', price: '', quantity: '0' };
}

export function ProductFormModal({ storeId, product, onClose, onSaved }: ProductFormModalProps) {
  const { push } = useToast();
  const isEdit = Boolean(product);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [quantity, setQuantity] = useState(product?.inventory ? String(product.inventory.quantity) : '0');
  const [description, setDescription] = useState(product?.description ?? '');
  const [status, setStatus] = useState(product?.status ?? 'active');
  const [categoriesText, setCategoriesText] = useState((product?.categories ?? []).join(', '));
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [variants, setVariants] = useState<ProductFormVariant[]>(
    (product?.variants ?? []).map((v) => ({ id: v.id, name: v.name, sku: v.sku ?? '', price: v.price !== null ? String(v.price) : '', quantity: String(v.quantity) })),
  );
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function addImagesFromFiles(files: FileList | null) {
    if (!files) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      push(`You can attach at most ${MAX_IMAGES} images.`, 'error');
      return;
    }
    Array.from(files)
      .slice(0, remaining)
      .forEach((file) => {
        if (!file.type.startsWith('image/')) return;
        if (file.size > MAX_IMAGE_BYTES) {
          push(`${file.name} is too large (max ${Math.round(MAX_IMAGE_BYTES / 1_000_000)}MB).`, 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') setImages((prev) => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
  }

  function addImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      push('Image URL must start with http:// or https://', 'error');
      return;
    }
    if (images.length >= MAX_IMAGES) {
      push(`You can attach at most ${MAX_IMAGES} images.`, 'error');
      return;
    }
    setImages((prev) => [...prev, url]);
    setImageUrlInput('');
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }

  function updateVariant(index: number, patch: Partial<ProductFormVariant>) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sku.trim() || price === '') {
      push('Name, SKU, and price are required.', 'error');
      return;
    }
    setSubmitting(true);

    const categories = categoriesText
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const cleanVariants = variants
      .filter((v) => v.name.trim())
      .map((v) => ({
        id: v.id,
        name: v.name.trim(),
        sku: v.sku.trim() || undefined,
        price: v.price !== '' ? Number(v.price) : undefined,
        quantity: v.quantity !== '' ? Number(v.quantity) : 0,
      }));

    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: Number(price),
      status,
      images,
      categories,
      variants: cleanVariants,
    };

    let res;
    if (isEdit && product) {
      res = await apiFetch(`/api/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      res = await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({ ...body, storeId, sku: sku.trim(), quantity: Number(quantity || 0) }),
      });
    }

    setSubmitting(false);
    if (res.error) {
      push(res.error.message, 'error');
      return;
    }
    push(isEdit ? 'Product updated.' : 'Product created.', 'success');
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close product form" onClick={onClose} className="fixed inset-0 bg-black/50" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[rgb(var(--bg))] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit product' : 'New product'}</h2>
          <button aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">SKU</label>
              <input required disabled={isEdit} value={sku} onChange={(e) => setSku(e.target.value)} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm disabled:opacity-60" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Price (minor units, e.g. kobo)</label>
              <input required type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
            </div>
            {!isEdit && (
              <div>
                <label className="mb-1 block text-xs font-medium">Stock</label>
                <input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm">
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Categories (comma-separated)</label>
              <input value={categoriesText} onChange={(e) => setCategoriesText(e.target.value)} placeholder="Shoes, Sale" className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Description</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Images</label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addImagesFromFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-xs text-[rgb(var(--text-muted))] ${
                dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[rgb(var(--border))]'
              }`}
            >
              <UploadCloud className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
              <span>Drag &amp; drop images here, or click to choose from your device</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addImagesFromFiles(e.target.files)}
              />
            </div>

            <div className="mt-2 flex gap-2">
              <input
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                placeholder="Or paste an image URL"
                className="min-w-0 flex-1 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 text-sm"
              />
              <button type="button" onClick={addImageUrl} className="flex shrink-0 items-center gap-1 rounded-lg border border-[rgb(var(--border))] px-3 py-2 text-sm">
                <LinkIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Add
              </button>
            </div>

            {images.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {images.map((src, i) => (
                  <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[rgb(var(--border))]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Product image ${i + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() => removeImage(i)}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium">Variants</label>
              <button type="button" onClick={addVariant} className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400">
                <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Add variant
              </button>
            </div>
            {variants.length === 0 ? (
              <p className="text-xs text-[rgb(var(--text-muted))]">No variants — this product is sold as a single option.</p>
            ) : (
              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-[rgb(var(--border))] p-2">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-[10px] font-medium uppercase text-[rgb(var(--text-muted))]">Name</label>
                      <input value={v.name} onChange={(e) => updateVariant(i, { name: e.target.value })} placeholder="e.g. Large / Red" className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1.5 text-xs" />
                    </div>
                    <div className="w-24">
                      <label className="mb-1 block text-[10px] font-medium uppercase text-[rgb(var(--text-muted))]">SKU</label>
                      <input value={v.sku} onChange={(e) => updateVariant(i, { sku: e.target.value })} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1.5 text-xs" />
                    </div>
                    <div className="w-24">
                      <label className="mb-1 block text-[10px] font-medium uppercase text-[rgb(var(--text-muted))]">Price</label>
                      <input type="number" min="0" value={v.price} onChange={(e) => updateVariant(i, { price: e.target.value })} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1.5 text-xs" />
                    </div>
                    <div className="w-20">
                      <label className="mb-1 block text-[10px] font-medium uppercase text-[rgb(var(--text-muted))]">Qty</label>
                      <input type="number" min="0" value={v.quantity} onChange={(e) => updateVariant(i, { quantity: e.target.value })} className="w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1.5 text-xs" />
                    </div>
                    <button type="button" aria-label="Remove variant" onClick={() => removeVariant(i)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[rgb(var(--border))] pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-[rgb(var(--border))] px-4 py-2 text-sm font-medium">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
