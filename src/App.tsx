import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Loader2,
  Play,
  UploadCloud,
  Image as ImageIcon,
  LinkIcon,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

// Use Vite proxy in dev so the browser stays same-origin (no CORS)
// Your vite.config.ts should proxy "/api" -> your n8n host and strip "/api"
const BASE = '/api/webhook-test';

// n8n returns absolute resumeUrl values (e.g., https://n8n.example.com/webhook-wait/...)
// Rewrite them to go through the Vite proxy in dev (/api + path), keeping any query string.
function toProxied(urlOrPath: string) {
  try {
    const u = new URL(urlOrPath);
    return '/api' + u.pathname + u.search;
  } catch {
    // If it's already relative, ensure it has the /api prefix
    return urlOrPath.startsWith('/api') ? urlOrPath : '/api' + (urlOrPath.startsWith('/') ? '' : '/') + urlOrPath;
  }
}

// Simple full-card loading overlay
function LoadingOverlay({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-black/40 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm text-slate-100">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </div>
    </div>
  );
}

// --- helpers for robust payload parsing ---
function normalizeImages(imagesField: unknown): string[] {
  if (!imagesField) return [];
  if (Array.isArray(imagesField)) {
    return imagesField.map((s) => String(s).trim()).filter(Boolean);
  }
  const asStr = String(imagesField).trim();
  // Try JSON array first
  if (asStr.startsWith('[') && asStr.endsWith(']')) {
    try {
      const arr = JSON.parse(asStr);
      if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean);
    } catch {}
  }
  // Fallback: comma-separated URLs (with or without surrounding quotes)
  return asStr
    .replace(/^\[|\]$/g, '')
    .split(/\s*,\s*/)
    .map((s) => s.replace(/^\"|\"$/g, '').trim())
    .filter(Boolean);
}

function coerceRootFromAny(data: any): any {
  // Accept array-wrapped payloads like: [ { ok, resumeUrl, images, message } ]
  if (Array.isArray(data)) return data[0] ?? {};
  return data ?? {};
}

export default function App() {
  type Status = 'idle' | 'pending' | 'done' | 'error';
  type Deliverable = Record<string, string>;

  const [activeTab, setActiveTab] = useState<'trigger' | 'uploadStyle' | 'compose' | 'review' | 'results' | 'finals'>('trigger');
  const [resumeUrl, setResumeUrl] = useState('');

  // Compose data
  const [prompt, setPrompt] = useState('');
  const [filesDocs, setFilesDocs] = useState<File[]>([]);

  // Style images (first step after trigger)
  const [filesStyle, setFilesStyle] = useState<File[]>([]);

  // Loading flags per section
  const [isTriggering, setIsTriggering] = useState(false);
  const [isUploadingStyle, setIsUploadingStyle] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const [status, setStatus] = useState<Status>('idle');
  const [images, setImages] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  // Review / prompts
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  // Results selections + feedback
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [imgFeedback, setImgFeedback] = useState<Record<string, string>>({});
  const [sendingImages, setSendingImages] = useState(false);

  // Finals state
  const [finalStatus, setFinalStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [finalMessage, setFinalMessage] = useState('');
  const [finalVideos, setFinalVideos] = useState<string[]>([]);

  const resultsAbortRef = useRef<AbortController | null>(null);

  function imgKey(src: string, i: number) {
    return `${src}-${i}`; // unique even with duplicate URLs
  }

  // Initialize selection/feedback whenever images change
  useEffect(() => {
    if (!images || images.length === 0) {
      setSelected({});
      setImgFeedback({});
      return;
    }
    setSelected((prev) => {
      const next = { ...prev };
      images.forEach((src, i) => {
        const k = imgKey(src, i);
        if (next[k] == null) next[k] = false;
      });
      return next;
    });
    setImgFeedback((prev) => {
      const next = { ...prev };
      images.forEach((src, i) => {
        const k = imgKey(src, i);
        if (next[k] == null) next[k] = '';
      });
      return next;
    });
  }, [images]);

  // Abort any in-flight poll on unmount
  useEffect(() => () => resultsAbortRef.current?.abort(), []);

  // --- TRIGGER (only button) ---
  async function triggerWorkflow() {
    setIsTriggering(true);
    setMessage('');
    try {
      const res = await fetch(`${BASE}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // no clientId anymore
      });
      if (!res.ok) throw new Error(`Trigger failed: ${res.status}`);
      const data = await res.json();
      const first = data.resumeUrl;
      if (!first) throw new Error('No resume URL returned by webhook');
      setResumeUrl(first);
      setActiveTab('uploadStyle');
    } catch (err: any) {
      setMessage(err.message || 'Failed to trigger');
    } finally {
      setIsTriggering(false);
    }
  }

  // --- UPLOAD: STYLE IMAGES (FIRST) ---
  function onPickStyle(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setFilesStyle(Array.from(e.target.files));
  }

  async function submitUploadStyle() {
    if (!resumeUrl) return;
    setIsUploadingStyle(true);
    setMessage('');
    try {
      const form = new FormData();
      filesStyle.forEach((f) => form.append('data', f));
      const res = await fetch(toProxied(resumeUrl), { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      let next: any = null;
      try { next = await res.json(); } catch {}
      if (next && next.resumeUrl) setResumeUrl(String(next.resumeUrl));
      setActiveTab('compose');
    } catch (err: any) {
      setMessage(err.message || 'Upload error');
    } finally {
      setIsUploadingStyle(false);
    }
  }

  // --- COMPOSE: UPLOAD DOCUMENTS + PROMPT TOGETHER ---
  function onPickDocs(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setFilesDocs(Array.from(e.target.files));
  }

  async function submitCompose() {
    if (!resumeUrl) return;
    setIsComposing(true);
    setMessage('');
    try {
      const form = new FormData();
      filesDocs.forEach((f) => form.append('files', f));
      form.append('prompt', prompt);

      const res = await fetch(toProxied(resumeUrl), { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Compose step failed: ${res.status}`);

      let next: any = null;
      try { next = await res.json(); } catch {}

      const maybeRoot = Array.isArray(next) ? next[0] : next;
      if (maybeRoot && maybeRoot.DELIVERABLES) {
        if (maybeRoot.resumeUrl) setResumeUrl(String(maybeRoot.resumeUrl));
        const normalized = (maybeRoot.DELIVERABLES as any[]).map((d: any) => {
          const out: Record<string, string> = {};
          Object.entries(d || {}).forEach(([k, v]) => (out[k] = String(v ?? '')));
          return out;
        });
        setDeliverables(normalized);
        setActiveTab('review');
        return;
      }

      if (next && next.resumeUrl) setResumeUrl(String(next.resumeUrl));

      setActiveTab('review');
      void fetchReview();
    } catch (err: any) {
      setMessage(err.message || 'Failed sending files + prompt');
    } finally {
      setIsComposing(false);
    }
  }

  // --- REVIEW: fetch prompts created by n8n ---
  async function fetchReview() {
    if (!resumeUrl) return;
    setIsSubmittingReview(true);
    setMessage('');
    try {
      const res = await fetch(toProxied(resumeUrl));
      if (!res.ok) throw new Error(`Failed to fetch review payload: ${res.status}`);

      let data: any;
      const text = await res.text();
      try { data = JSON.parse(text); } catch { data = text as any; }

      const root = Array.isArray(data) ? data[0] : data;
      if (!root || !root.DELIVERABLES) throw new Error('No DELIVERABLES found in payload');

      if (root.resumeUrl) setResumeUrl(String(root.resumeUrl));

      const normalized: Deliverable[] = (root.DELIVERABLES as any[]).map((d: any) => {
        const out: Deliverable = {};
        Object.entries(d || {}).forEach(([k, v]) => (out[k] = String(v ?? '')));
        return out;
      });
      setDeliverables(normalized);
      setActiveTab('review');
    } catch (err: any) {
      setMessage(err.message || 'Could not load prompts for review');
    } finally {
      setIsSubmittingReview(false);
    }
  }

  // --- REVIEW: utility to extract only the scene description
  function getSceneDescription(d: Deliverable): string {
    // Prefer exact key first
    if (d['Scene Description']) return d['Scene Description'];
    // Fallback: any key containing both "scene" and "description"
    const found = Object.entries(d).find(([k]) => /scene/i.test(k) && /description/i.test(k));
    if (found) return String(found[1] ?? '');
    // Last resort: Description
    if (d['Description']) return d['Description'];
    return '';
  }

  // --- REVIEW: send edited prompts back to n8n (Option A: consume POST response images)
  async function sendBackToN8n() {
    if (!resumeUrl) return;
    if (isSubmittingReview) return;
    setIsSubmittingReview(true);
    setMessage('');
    try {
      const payload = [
        {
          ok: true,
          resumeUrl,
          DELIVERABLES: deliverables,
        },
      ];
      const res = await fetch(toProxied(resumeUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to submit review: ${res.status}`);

      // Read raw text so we can handle both JSON and plain text safely
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = text as any;
      }

      // Accept either array-wrapped or plain object
      const root = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
      if (root?.resumeUrl) setResumeUrl(String(root.resumeUrl));

      const imgs = normalizeImages(root?.images);
      const msg = root?.message || '';
      const st = String(root?.status || '').toLowerCase();

      // If images arrived in the POST response, render immediately
      if (imgs.length > 0) {
        setImages(imgs);
        setStatus('done');
        if (msg) setMessage(msg);
        setActiveTab('results');
        return; // ✅ no GET polling needed
      }

      // Legacy-style explicit states
      if (st === 'done') {
        setStatus('done');
        if (msg) setMessage(msg);
        setActiveTab('results');
        return;
      }

      if (st === 'error') {
        setStatus('error');
        setMessage(msg || 'An error occurred in the workflow');
        setActiveTab('results');
        return;
      }

      // Fallback: go to Results and poll via GET if nothing was in the POST
      setActiveTab('results');
      await fetchResults();
    } catch (err: any) {
      setMessage(err.message || 'Submission error');
    } finally {
      setIsSubmittingReview(false);
    }
  }

  // --- RESULTS POLLING ---
  async function fetchResults() {
    if (!resumeUrl) return;
    setStatus('pending');
    resultsAbortRef.current?.abort();
    const controller = new AbortController();
    resultsAbortRef.current = controller;
    try {
      const res = await fetch(toProxied(resumeUrl), { signal: controller.signal });
      if (!res.ok) throw new Error(`Polling error: ${res.status}`);

      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = text as any; }

      let imgs: string[] = [];
      let msg = '';
      let state: Status | undefined;

      if (typeof data === 'object' && data && 'status' in data) {
        imgs = normalizeImages((data as any).images);
        msg = (data as any).message || '';
        const st = String((data as any).status || '').toLowerCase();
        state = st === 'done' ? 'done' : st === 'error' ? 'error' : 'pending';
      } else {
        const root = coerceRootFromAny(data);
        imgs = normalizeImages(root?.images);
        msg = root?.message || '';
        state = root?.ok ? 'done' : undefined;
        if (root?.resumeUrl) setResumeUrl(String(root.resumeUrl));
      }

      if (state === 'error') {
        setStatus('error');
        setMessage(msg || 'An error occurred in the workflow');
        return;
      }

      if (imgs.length > 0) {
        setImages(imgs);
        setStatus('done');
        if (msg) setMessage(msg);
        return;
      }

      setStatus(state ?? 'pending');
      if (!msg) setMessage('Waiting for images from n8n…');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setStatus('error');
      setMessage(e.message || 'Polling failed');
    }
  }

  // --- RESULTS: send selected images + feedback back to n8n ---
  async function sendSelectedImagesBack() {
    if (!resumeUrl) return;

    const selections = images
      .map((src, i) => {
        const k = imgKey(src, i);
        if (!selected[k]) return null;
        return { image: src, feedback: (imgFeedback[k] || '').trim(), index: i };
      })
      .filter(Boolean) as Array<{ image: string; feedback: string; index: number }>;

    if (selections.length === 0) {
      setMessage('Select at least one image before sending.');
      return;
    }

    setSendingImages(true);
    setMessage('');
    setStatus('pending');

    try {
      const payload = [{ ok: true, resumeUrl, selections }];

      const res = await fetch(toProxied(resumeUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        setStatus('error');
        setMessage(`n8n responded ${res.status}. ${errTxt || ''}`.trim());
        return;
      }

      const raw = await res.text();
      let data: any = raw;
      try { data = JSON.parse(raw); } catch { /* keep as text if not JSON */ }

      const root = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
      if (root?.resumeUrl) setResumeUrl(String(root.resumeUrl));

      const imgs = normalizeImages(root?.images);
      const msg = root?.message || '';
      const st = String(root?.status || '').toLowerCase();

      if (st === 'error') {
        setStatus('error');
        setMessage(msg || 'Workflow reported an error.');
        return;
      }

      if (imgs.length > 0) {
        setImages(imgs);
        setStatus('done');
        if (msg) setMessage(msg);
        setActiveTab('results');
        return;
      }

      setStatus('pending');
      setMessage(msg || 'Waiting for images from n8n…');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'Failed to send selected images');
    } finally {
      setSendingImages(false);
    }
  }

  // --- FINALS: send selected images to n8n and expect JSON with videos ---
  async function sendImagesForFinals() {
    if (!resumeUrl) return;

    const selections = images
      .map((src, i) => {
        const k = imgKey(src, i);
        if (!selected[k]) return null;
        return { image: src, feedback: (imgFeedback[k] || '').trim(), index: i };
      })
      .filter(Boolean) as Array<{ image: string; feedback: string; index: number }>;

    if (selections.length === 0) {
      setMessage('Select at least one image before sending.');
      return;
    }

    setActiveTab('finals');
    setFinalStatus('pending');
    setFinalMessage('Generating videos from selected images…');

    try {
      const payload = [{ ok: true, resumeUrl, selections }];
      const res = await fetch(toProxied(resumeUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      if (!res.ok) {
        setFinalStatus('error');
        setFinalMessage(`n8n responded ${res.status}. ${raw || ''}`.trim());
        return;
      }

      let data: any = null;
      try { data = JSON.parse(raw); } catch {
        const start = Math.min(...['[','{'].map(ch => raw.indexOf(ch)).filter(i => i !== -1));
        const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
        if (start >= 0 && end > start) {
          try { data = JSON.parse(raw.slice(start, end + 1)); } catch {}
        }
      }
      if (!data) {
        if (/Workflow was started/i.test(raw)) {
          setFinalStatus('error');
          setFinalMessage('Got “Workflow was started”. Ensure POST hits /webhook-wait/ and Webhook uses “Respond to Webhook”.');
          return;
        }
        setFinalStatus('error');
        setFinalMessage('Could not parse response JSON from n8n.');
        return;
      }

      const root = Array.isArray(data) ? (data[0] ?? {}) : data;

      const maybeResume = String(root?.resumeUrl || '');
      if (/^(https?:\/\/|\/)/i.test(maybeResume) && !/\[filled at execution time\]/i.test(maybeResume)) {
        setResumeUrl(maybeResume);
      }

      const pickList = (val: any): string[] => {
        if (Array.isArray(val)) return val.map(String).filter(Boolean);
        if (typeof val === 'string') {
          try { const arr = JSON.parse(val); if (Array.isArray(arr)) return arr.map(String).filter(Boolean); } catch {}
          return val.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
        }
        return [];
      };

      const videos =
        pickList(root.videos) ||
        pickList(root.VIDEOS) ||
        pickList(root.media) ||
        pickList(root.urls) ||
        [];

      const msg = String(root?.message || '');
      const st = String(root?.status || '').toLowerCase();
      const ok = Boolean(root?.ok);

      if ((videos && videos.length > 0) || ok || st === 'done') {
        setFinalVideos(videos || []);
        setFinalStatus('done');
        setFinalMessage(msg || (videos?.length ? `Received ${videos.length} video(s).` : 'Done.'));
        return;
      }

      setFinalStatus('pending');
      setFinalMessage(msg || 'Waiting for videos from n8n…');
    } catch (err: any) {
      setFinalStatus('error');
      setFinalMessage(err?.message || 'Failed to request videos');
    }
  }

  function resetAll() {
    setPrompt('');
    setFilesDocs([]);
    setFilesStyle([]);
    setImages([]);
    setDeliverables([]);
    setSelected({});
    setImgFeedback({});
    setStatus('idle');
    setMessage('');
    setFinalVideos([]);
    setFinalStatus('idle');
    setFinalMessage('');
    setResumeUrl('');
    setActiveTab('trigger');
  }

  function updateDeliverable(idx: number, key: string, value: string) {
    setDeliverables((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  }

  // --- UI ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-black p-6 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">n8n Webhook UI</h1>
            <p className="text-sm text-slate-400">Flow: Trigger → Style Upload → Compose (files + prompt) → Review Prompts → Results → Finals.</p>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-6 bg-slate-800">
            <TabsTrigger className="data-[state=active]:bg-slate-700" value="trigger">Trigger</TabsTrigger>
            <TabsTrigger className="data-[state=active]:bg-slate-700" value="uploadStyle" disabled={!resumeUrl}>Style Upload</TabsTrigger>
            <TabsTrigger className="data-[state=active]:bg-slate-700" value="compose" disabled={!resumeUrl}>Compose</TabsTrigger>
            <TabsTrigger className="data-[state=active]:bg-slate-700" value="review" disabled={!resumeUrl}>Review</TabsTrigger>
            <TabsTrigger className="data-[state=active]:bg-slate-700" value="results" disabled={!resumeUrl}>Results</TabsTrigger>
            <TabsTrigger className="data-[state=active]:bg-slate-700" value="finals" disabled={!resumeUrl}>Finals</TabsTrigger>
          </TabsList>

          {/* TRIGGER */}
          <TabsContent value="trigger">
            <Card className="mt-4 shadow-sm relative border-slate-700 bg-slate-900">
              {isTriggering && <LoadingOverlay label="Triggering…" />}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5" /> Start Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button onClick={triggerWorkflow} disabled={isTriggering}>
                    {isTriggering ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Triggering…
                      </>
                    ) : (
                      <>Trigger via Webhook</>
                    )}
                  </Button>
                </div>
                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* UPLOAD STYLE */}
          <TabsContent value="uploadStyle">
            <Card className="mt-4 shadow-sm relative border-slate-700 bg-slate-900">
              {isUploadingStyle && <LoadingOverlay label="Uploading style images…" />}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" /> Style Image Upload
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Style images</Label>
                  <Input type="file" multiple accept=".png,.jpg,.jpeg,.webp" onChange={onPickStyle} className="bg-slate-800 border-slate-700 text-slate-100 file:text-slate-300" />
                  {!!filesStyle.length && (
                    <ul className="list-disc pl-4 text-xs text-slate-400">
                      {filesStyle.map((f) => (
                        <li key={f.name}>{f.name} – {Math.round(f.size / 1024)} KB</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={submitUploadStyle} disabled={isUploadingStyle || filesStyle.length === 0}>
                    {isUploadingStyle ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
                      </>
                    ) : (
                      <>Send to resumeUrl</>
                    )}
                  </Button>
                </div>
                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* COMPOSE */}
          <TabsContent value="compose">
            <Card className="mt-4 shadow-sm relative border-slate-700 bg-slate-900">
              {isComposing && <LoadingOverlay label="Sending files + prompt…" />}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UploadCloud className="h-5 w-5" /> Compose (Upload + Prompt)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-2">
                  <Label>Files</Label>
                  <Input type="file" multiple accept=".pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.webp,.json,.csv" onChange={onPickDocs} className="bg-slate-800 border-slate-700 text-slate-100 file:text-slate-300" />
                  {!!filesDocs.length && (
                    <ul className="list-disc pl-4 text-xs text-slate-400">
                      {filesDocs.map((f) => (
                        <li key={f.name}>{f.name} – {Math.round(f.size / 1024)} KB</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="prompt">Prompt</Label>
                  <Textarea id="prompt" rows={6} placeholder="e.g., Generate 4 cinematic product renders with a moody, backlit look…" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-400" />
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={submitCompose} disabled={isComposing || filesDocs.length === 0 || !prompt.trim()}>
                    {isComposing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      <>Send to n8n</>
                    )}
                  </Button>
                </div>
                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* REVIEW — only Scene Description per deliverable */}
          <TabsContent value="review">
            <Card className="mt-4 shadow-sm relative border-slate-700 bg-slate-900">
              {isSubmittingReview && <LoadingOverlay label="Loading prompts…" />}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" /> Review Prompts (Scene Descriptions)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={fetchReview} disabled={!resumeUrl || isSubmittingReview}>
                    Refresh from n8n
                  </Button>
                  <TinyBadge label={`items: ${deliverables.length}`} />
                </div>

                {deliverables.length === 0 && (
                  <p className="text-sm text-slate-400">No prompts loaded yet. Click “Refresh from n8n”.</p>
                )}

                <div className="space-y-4">
                  {deliverables.map((d, idx) => {
                    const desc = getSceneDescription(d);
                    return (
                      <div key={idx} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-xs uppercase text-slate-400">Deliverable #{idx + 1}</span>
                          <TinyBadge label={`#${idx + 1}`} />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-slate-300">Scene Description</Label>
                          <Textarea
                            readOnly
                            rows={6}
                            value={desc || '—'}
                            className="bg-slate-800 border-slate-700 text-slate-100"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={sendBackToN8n} disabled={!resumeUrl || deliverables.length === 0 || isSubmittingReview}>
                    Send Back to n8n
                  </Button>
                  <Button variant="outline" onClick={resetAll}>New Run</Button>
                </div>

                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* RESULTS */}
          <TabsContent value="results">
            <Card className="mt-4 shadow-sm relative border-slate-700 bg-slate-900">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" /> Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={fetchResults} variant="secondary" disabled={!resumeUrl || status === 'pending'}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                  </Button>
                  <Button variant="outline" onClick={resetAll}>New Run</Button>
                  <Button onClick={sendSelectedImagesBack} disabled={!resumeUrl || sendingImages}>
                    {sendingImages ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      <>Send back images</>
                    )}
                  </Button>
                  <Button
                    onClick={sendImagesForFinals}
                    disabled={!resumeUrl || finalStatus === 'pending'}
                    aria-busy={finalStatus === 'pending'}
                  >
                    {finalStatus === 'pending' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Generating Finals…
                      </>
                    ) : (
                      <>Generate Finals (videos)</>
                    )}
                  </Button>
                  <TinyBadge label={`status: ${status}`} />
                  <TinyBadge label={`selected: ${Object.values(selected).filter(Boolean).length}`} />
                </div>

                {message && <p className="text-sm text-slate-400">{message}</p>}

                <AnimatePresence mode="popLayout">
                  {status === 'done' && images.length > 0 && (
                    <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {images.map((src, i) => {
                        const k = imgKey(src, i);
                        return (
                          <motion.div
                            key={k}
                            layout
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-sm"
                          >
                            <a
                              href={src}
                              target="_blank"
                              rel="noreferrer"
                              className="group block"
                            >
                              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-800">
                                <img src={src} alt={`result-${i + 1}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                              </div>
                            </a>
                            <div className="flex items-center justify-between p-3 text-xs text-slate-400">
                              <span>Image {i + 1}</span>
                              <span className="inline-flex items-center gap-1">
                                <LinkIcon className="h-3 w-3" /> Open
                              </span>
                            </div>

                            {/* Selection + feedback controls */}
                            <div className="border-t border-slate-700 p-3 space-y-3">
                              <label className="flex items-center gap-2 text-sm" htmlFor={k}>
                                <input
                                  id={k}
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={!!selected[k]}
                                  onChange={(e) =>
                                    setSelected((prev) => ({ ...prev, [k]: e.target.checked }))
                                  }
                                />
                                Select this image
                              </label>

                              <div className="grid gap-1">
                                <Label className="text-xs text-slate-300">Feedback (optional)</Label>
                                <Textarea
                                  rows={3}
                                  placeholder="Describe changes you want for this image…"
                                  value={imgFeedback[k] || ''}
                                  onChange={(e) =>
                                    setImgFeedback((prev) => ({ ...prev, [k]: e.target.value }))
                                  }
                                  className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-400"
                                />
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>

                {status === 'pending' && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Waiting for images from n8n…
                  </div>
                )}

                {status === 'done' && images.length === 0 && (
                  <p className="text-sm text-slate-400">No images returned for this run.</p>
                )}

                {status === 'error' && (
                  <p className="text-sm text-red-400">There was a problem fetching results.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* FINALS */}
          <TabsContent value="finals">
            <Card className="mt-4 shadow-sm relative border-slate-700 bg-slate-900">
              {finalStatus === 'pending' && <LoadingOverlay label="Processing feedback…" />}
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" /> Final Videos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={resetAll}>New Run</Button>
                  <TinyBadge label={`status: ${finalStatus}`} />
                </div>

                {finalMessage && <p className="text-sm text-slate-400">{finalMessage}</p>}

                {finalStatus === 'pending' && (
                  <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-black/40">
                    <div className="flex items-center gap-2 text-sm text-slate-100">
                      <Loader2 className="h-4 w-4 animate-spin" /> Generating videos…
                    </div>
                  </div>
                )}

                {finalStatus === 'done' && finalVideos.length > 0 && (
                  <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {finalVideos.map((src, i) => (
                      <motion.div
                        key={`${src}-${i}`}
                        layout
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="group overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-sm"
                      >
                        <div className="aspect-video w-full bg-black">
                          <video src={src} controls preload="metadata" className="h-full w-full" />
                        </div>
                        <div className="flex items-center justify-between p-3 text-xs text-slate-400">
                          <span>Video {i + 1}</span>
                          <a href={src} download className="underline">Download</a>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}

                {finalStatus === 'error' && (
                  <p className="text-sm text-red-400">There was a problem receiving final videos.</p>
                )}

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <footer className="mt-8 text-center text-xs text-slate-500">
          <p>
            Webhook base: <code className="text-slate-300">{BASE}</code>
          </p>
        </footer>
      </div>
    </div>
  );
}

// Helpers used in the UI
function Feedback({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200" role="status" aria-live="polite">
      {message}
    </div>
  );
}

function TinyBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
      {label}
    </span>
  );
}
