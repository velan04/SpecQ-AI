// src/services/api.js
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Upload testcase content (string from ZIP) + description HTML → trigger pipeline.
 * testcaseContent   : string — raw JS from ZipFileExplorer
 * descriptionContent: string — HTML from RichTextEditor (may contain base64 images)
 */
export const startPipeline = async (testcaseContent, descriptionContent) => {
  const form = new FormData();
  form.append('testcase',    new Blob([testcaseContent],    { type: 'text/javascript' }), 'testcase.js');
  form.append('description', new Blob([descriptionContent], { type: 'text/plain' }),      'description.txt');
  const res = await fetch(`${BASE}/api/run`, { method: 'POST', body: form });
  return res.json();
};

/** Poll pipeline status: { running: bool, error: string|null } */
export const getStatus = () =>
  fetch(`${BASE}/api/status`).then(r => r.json());

/** Fetch final QC report JSON */
export const getReport = () =>
  fetch(`${BASE}/api/report`).then(r => r.json());

/** Open WebSocket for live log streaming. Sends "__DONE__" when pipeline finishes */
export const createLogSocket = () =>
  new WebSocket(`ws://localhost:8000/api/logs`);