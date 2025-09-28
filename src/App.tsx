import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from 'lucide-react';

const BASE =
  import.meta.env.VITE_N8N_WEBHOOK_BASE ||
  'http://localhost:5678/webhook';

export default function App() {
  const [activeTab, setActiveTab] = useState('trigger');
  const [resumeUrl, setResumeUrl] = useState('');
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [images, setImages] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  async function triggerWorkflow() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`${BASE}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) throw new Error(`Trigger failed: ${res.status}`);
      const data = await res.json();
      const first = data.resumeUrl;
      if (!first) throw new Error('No resume URL returned by webhook');
      setResumeUrl(first);
      setActiveTab('upload');
    } catch (err: any) {
      setMessage(err.message || 'Failed to trigger');
    } finally {
      setLoading(false);
    }
  }

  async function submitUpload() {
    if (!resumeUrl) return;
    setLoading(true);
    setMessage('');
    console.log(resumeUrl)
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await fetch(resumeUrl, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      let next: any = null;
      try { next = await res.json(); } catch {}
      if (next && next.resumeUrl) setResumeUrl(String(next.resumeUrl));
      console.log(resumeUrl);
      setActiveTab('prompt');
    } catch (err: any) {
      setMessage(err.message || 'Upload error');
    } finally {
      setLoading(false);
    }
  }

  async function submitPrompt() {
    if (!resumeUrl) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(resumeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`Prompt failed: ${res.status}`);
      let next: any = null;
      try { next = await res.json(); } catch {}
      // If backend returns final images immediately, you can also check next.status here.
      if (next && next.resumeUrl) setResumeUrl(String(next.resumeUrl)); // results URL
      setActiveTab('results');
      fetchResults();
    } catch (err: any) {
      setMessage(err.message || 'Failed sending prompt');
    } finally {
      setLoading(false);
    }
  }

  async function fetchResults() {
    if (!resumeUrl) return;
    setStatus('pending');
    try {
      const res = await fetch(resumeUrl);
      if (!res.ok) throw new Error('Polling error');
      const data = await res.json();
      if (data.status === 'done') {
        setImages(Array.isArray(data.images) ? data.images : []);
        setStatus('done');
        setMessage(data.message || '');
      } else if (data.status === 'error') {
        setStatus('error');
        setMessage(data.message || 'An error occurred in the workflow');
      } else {
        setStatus('pending');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || 'Polling failed');
    }
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setFiles(Array.from(e.target.files));
  }

  function resetAll() {
    setPrompt('');
    setFiles([]);
    setImages([]);
    setStatus('idle');
    setMessage('');
    setResumeUrl('');
    setActiveTab('trigger');
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              n8n Webhook UI
            </h1>
            <p className="text-sm text-muted-foreground">
              Trigger once, then send files and prompt via $execution.resumeUrl endpoints.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-1">
              clientId: {clientId.slice(0, 8)}…
            </span>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="trigger">Trigger</TabsTrigger>
            <TabsTrigger value="upload" disabled={!resumeUrl}>
              Upload
            </TabsTrigger>
            <TabsTrigger value="prompt" disabled={!resumeUrl}>
              Prompt
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!resumeUrl}>
              Results
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trigger">
            <Card className="mt-4 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5" /> Start Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Calls the main webhook, which returns the resume URLs for upload, prompt, and results.
                </p>
                <div className="grid gap-3">
                  <Label htmlFor="clientId">Optional clientId</Label>
                  <Input
                    id="clientId"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={triggerWorkflow} disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Triggering…
                      </>
                    ) : (
                      <>Trigger via Webhook</>
                    )}
                  </Button>
                  <EnvHint />
                </div>
                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="upload">
            <Card className="mt-4 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UploadCloud className="h-5 w-5" /> Upload Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Files</Label>
                  <Input
                    type="file"
                    multiple
                    accept=".pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.webp,.json,.csv"
                    onChange={onPickFiles}
                  />
                  {!!files.length && (
                    <ul className="text-xs text-muted-foreground list-disc pl-4">
                      {files.map((f) => (
                        <li key={f.name}>
                          {f.name} – {Math.round(f.size / 1024)} KB
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={submitUpload}
                    disabled={loading || files.length === 0}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading…
                      </>
                    ) : (
                      <>Send to resumeUrl</>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setActiveTab('prompt')}
                    disabled={!resumeUrl}
                  >
                    Go to Prompt
                  </Button>
                </div>
                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prompt">
            <Card className="mt-4 shadow-sm">
              <CardHeader>
                <CardTitle>User Prompt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="prompt">Describe what you want to generate</Label>
                  <Textarea
                    id="prompt"
                    rows={6}
                    placeholder="e.g., Generate 4 cinematic product renders with a moody, backlit look…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={submitPrompt} disabled={loading || !prompt}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>Send Prompt</>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setActiveTab('upload')}
                    disabled={!resumeUrl}
                  >
                    Back to Upload
                  </Button>
                </div>
                <Feedback message={message} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="results">
            <Card className="mt-4 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" /> Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button
                    onClick={fetchResults}
                    variant="secondary"
                    disabled={!resumeUrl || status === 'pending'}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                  </Button>
                  <Button variant="outline" onClick={resetAll}>
                    New Run
                  </Button>
                  <TinyBadge label={`status: ${status}`} />
                </div>
                {message && (
                  <p className="text-sm text-muted-foreground">{message}</p>
                )}

                <AnimatePresence mode="popLayout">
                  {status === 'done' && images.length > 0 && (
                    <motion.div
                      layout
                      className="grid grid-cols-1 gap-4 md:grid-cols-2"
                    >
                      {images.map((src, i) => (
                        <motion.a
                          key={src}
                          href={src}
                          target="_blank"
                          rel="noreferrer"
                          layout
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          className="group overflow-hidden rounded-2xl border bg-white shadow-sm"
                        >
                          <div className="aspect-[4/3] w-full overflow-hidden">
                            <img
                              src={src}
                              alt={`result-${i + 1}`}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          </div>
                          <div className="flex items-center justify-between p-3 text-xs text-muted-foreground">
                            <span>Image {i + 1}</span>
                            <span className="inline-flex items-center gap-1">
                              <LinkIcon className="h-3 w-3" />
                              Open
                            </span>
                          </div>
                        </motion.a>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {status === 'pending' && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Waiting for images from n8n…
                  </div>
                )}

                {status === 'done' && images.length === 0 && (
                  <p className="text-sm text-muted-foreground">No images returned for this run.</p>
                )}

                {status === 'error' && (
                  <p className="text-sm text-red-600">There was a problem fetching results.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          <p>
            Webhook base: <code>{BASE}</code>
          </p>
        </footer>
      </div>
    </div>
  );
}

function Feedback({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-xl border bg-amber-50 p-3 text-sm text-amber-900">{message}</div>;
}

function EnvHint() {
  return (
    <div className="text-xs text-muted-foreground">
      Main trigger returns resumeUrls (upload, prompt, results) via $execution.resumeUrl.
    </div>
  );
}

function TinyBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}
