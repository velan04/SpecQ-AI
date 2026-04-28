// src/services/api.js
const BASE    = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE = BASE.replace('https://', 'wss://').replace('http://', 'ws://');

/**
 * Upload testcase content + description HTML → trigger pipeline.
 * testcaseContent   : string  — raw JS extracted from ZIP
 * descriptionContent: string  — HTML from RichTextEditor (may contain base64 images)
 * scaffoldingZipFile: File|null — full scaffolding ZIP (package.json + node_modules + public/)
 */
export const startPipeline = async (testcaseContent, descriptionContent, scaffoldingZipFile = null) => {
  const form = new FormData();
  form.append('testcase',    new Blob([testcaseContent],    { type: 'text/javascript' }), 'testcase.js');
  form.append('description', new Blob([descriptionContent], { type: 'text/plain'       }), 'description.txt');
  if (scaffoldingZipFile) {
    form.append('scaffolding_zip', scaffoldingZipFile, 'scaffolding.zip');
  }
  const res = await fetch(`${BASE}/api/run`, { method: 'POST', body: form });
  return res.json();
};

/** Poll pipeline status: { running: bool, error: string|null } */
export const getStatus = () =>
  fetch(`${BASE}/api/status`).then(r => r.json());

/** Fetch final QC report JSON summary */
export const getReport = () =>
  fetch(`${BASE}/api/report`).then(r => r.json());

/** Download the Excel QC report as a Blob */
export const downloadExcelReport = () =>
  fetch(`${BASE}/api/report/excel`).then(r => r.blob());

/** Open WebSocket for live log streaming. Sends "__DONE__" when pipeline finishes */
export const createLogSocket = () =>
  new WebSocket(`${WS_BASE}/api/logs`);

/** Get AI-generated solution files: { "index.html": str, "style.css": str, "script.js": str } */
export const getSolutionFiles = () =>
  fetch(`${BASE}/api/solution-files`).then(r => r.json());

/** Overwrite AI-generated files on disk */
export const saveSolutionFiles = (files) =>
  fetch(`${BASE}/api/solution-files`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(files),
  }).then(r => r.json());

/** Cancel the pipeline */
export const cancelPipeline = () =>
  fetch(`${BASE}/api/cancel`, { method: 'POST' }).then(r => r.json());

/** Re-run Puppeteer tests on the current solution (no regeneration) */
export const runTestsOnly = () =>
  fetch(`${BASE}/api/run-tests`, { method: 'POST' }).then(r => r.json());

/** Base URL for the preview iframe */
export const getPreviewUrl = () => `${BASE}/api/preview/index.html`;

/** Fetch the description.txt used for the last AI generation */
export const getDescription = () =>
  fetch(`${BASE}/api/description`).then(r => r.json());

/** Fetch the testcase.js used for the last pipeline run */
export const getTestcase = () =>
  fetch(`${BASE}/api/testcase`).then(r => r.json());

/**
 * Search examly question banks by name.
 * Returns { questionbanks: [{qb_id, qb_name, questionCount, ...}], count }
 */
export const searchQuestionBanks = (searchTerm, token) => {
  const raw_token = token.toLowerCase().startsWith("bearer ") ? token.slice(7) : token;
  
  return fetch("https://api.examly.io/api/v2/questionbanks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": raw_token,
      "origin": "https://admin.orchard.iamneo.in",
      "referer": "https://admin.orchard.iamneo.in/",
    },
    body: JSON.stringify({
      branch_id: "all",
      page: 1,
      limit: 25,
      visibility: "All",
      search: searchTerm,
      department_id: [
    "617346bd-b9c8-468d-9099-12170fb3b570",
    "8c9bb195-1e81-4506-bc39-c48e6450c2a0",
    "58efa904-a695-4c14-8335-124c9ec5e95a",
    "4b375029-26ec-4d20-bf46-1122dfc584ae",
    "d40c4d09-8ac5-4a26-b969-ce9cc8685180",
    "e0f02ce1-486b-4122-8f1b-d80f7076bee3",
    "04c14795-d8b2-41c0-9c41-997a5630f455",
    "074cbc54-a20f-4a5d-9c02-1ca6a1bed28f",
    "da3f5269-34b1-49c4-8d38-30c18b4f6598",
    "f04c0f04-f6d7-434d-b8c9-5c356805ffab",
    "f0b8af1b-288a-4b41-97b1-27447014ada3",
    "2b60843d-7972-4235-82cb-0ebc33d75d63",
    "78b66861-c946-4d83-9754-75c32925b5a9",
    "5d1e18e7-b9aa-4d43-93b3-eb0a7a3df0d6",
    "82208516-6d07-4fc0-8ee4-4205601c6695",
    "b55a5b74-7f4a-428e-a59b-377dd8c7e4ba",
    "35700f99-19f6-42c2-a336-d32687690e4a",
    "c47b433a-7f1d-4014-a5b9-415187ed118b",
    "fb751a89-c97a-47a6-9795-a33b3ba2eede",
    "c02099c7-354a-48a9-867c-91cd16c6de38",
    "4bb74161-364a-4012-9122-be5597db9f9e",
    "a9ac9b80-daf9-45c3-aa4e-3aecd0a3820b",
    "91f6683d-2512-416a-a355-2c6eefe9507b",
    "6aa4e718-9fd9-4911-85c0-b900eed73547",
    "2d24fa30-2621-418b-9597-0442ff8997df",
    "5d4d3d63-73cd-4b04-a579-6c4f9fdf7473",
    "55faaca8-4375-4bc6-874e-740dbf3dd22e",
    "e100cac4-4586-4f3a-b598-24ee8d6c7a92",
    "ffa1501f-1747-4ea7-9b83-22b3ab409d51",
    "97c0a54a-67d2-4bc6-87b6-74b369e15889",
    "627f1e5a-3e5e-4e14-b948-eab0baf714c4",
    "d7d9bd6a-7bdc-46aa-8929-458e674f94c5",
    "c3d1f72d-aa83-4276-9976-c5fcb06f70f8",
    "4bf536a6-a9fa-4215-a803-056f0074e3e7",
    "2680fe23-89dc-4035-a7a6-eb1869630f81",
    "1dce25ce-cb7a-4826-a7e4-ab4c189bf436",
    "e641144f-f801-4f79-8f3b-cff27ab3a123",
    "7296cb61-76ce-4064-8928-328f2a545666",
    "48942306-1e80-4db5-bd3b-e3075202d9b8",
    "0ba8c5fa-9754-4d7f-851a-aa4791b9b445",
    "8b0329c3-626e-4644-b6f4-dcb0424ed9fa",
    "969b5384-e5ac-46aa-996b-547e5c77c3bf",
    "41b64d5f-bb55-47a7-ad77-208e27ccae80",
    "0400731b-2ab3-4644-828e-7c1618b23aac",
    "e024b5b6-d6db-4fe6-a445-8b49facf10bb",
    "d5c3f38f-fc70-4ac8-af83-372cd006396f",
    "09f0cbe3-5c20-4c75-9c50-b4ee6fa6d09a",
    "8154bcaa-3ee6-423f-938e-e4ccfe6002a7",
    "4d037902-f46b-4fcf-824a-8f65376dbdcc",
    "4ced5ede-47de-42b8-a5e3-a5af9d0ce415",
    "566994d3-6a6f-4174-899a-700468f4bc7a",
    "ebd40260-e32b-4367-8b8f-c606793e423b",
    "6adf26cd-4949-4501-99c4-336401d84b49",
    "64195871-472d-4520-839b-be0b8cbf2a94",
    "4af00c09-f6a8-4099-8699-1c6a57db677b",
    "0eb0005e-01b2-412a-a325-d0ea0ab9d64c",
    "282bae70-ecb4-469a-94d0-8df0917b6ed4",
    "62024afb-ea1e-4a6b-ad01-cbf1e592ed3c",
    "662bd1f5-9c20-411a-aad0-e00e1881a6f2",
    "54d15165-fc20-4e2e-bc1a-19e46c6a6f30",
    "3f3711bd-ba73-404a-b72a-dee82166d2b4",
    "a17c1837-80dd-4d0f-9a05-629e8f00eeb5",
    "617ce4f5-33ec-4ff6-b1a6-1c74220be379",
    "bf6ce3d6-8552-4959-bc65-9068c8f7738b",
    "3f0fd32e-4290-488f-8e93-ba49d4dc1ecd",
    "51827123-a24e-4aac-a23b-cbf3b95177e5",
    "7a309bfc-d490-4269-8c36-f2899e02de65",
    "9a64ffc7-47af-4f28-8dfa-31718a16ea7b",
    "bd3777c4-635f-435a-94da-3426f786d592",
    "6204bdfd-9a00-42b5-b951-0ab9a7a22105",
    "173df851-7e75-43f1-9185-19028621a66f",
    "e9fecb8e-8553-4d23-ac96-eca3da15af90",
    "8eeae087-ce46-4d8a-9d0d-aefef190f0cd",
    "00522911-f5fa-48fd-acb2-333b40117b82",
    "41698284-bb61-4f6c-aaf1-591182d9025d",
    "901ff1b8-cc03-4bb3-96b9-42bb53e86701",
    "5c490195-95f7-4577-a9cb-3096d940af5d",
    "1b18fbbf-a4ca-45df-ab78-75480a154b4a",
    "ef6771c4-b9f5-4593-b4f6-ae9cd8845ec2",
    "b073f250-c7eb-4d6b-829e-3af6ceb94037",
    "78dc3377-b4a2-4338-b17e-6d8dde7cfeb1",
    "ba75398b-44ce-487a-9dcd-f57339241e8d",
    "a09496c9-0412-4649-944f-2edca43cb252",
    "756c5ccf-535e-4b26-8d5f-3acc607e9a81",
    "34c1f447-25af-4a75-9abf-be10d1626076",
    "82156a68-a333-4217-8ac6-4863dd04d457",
    "e329730f-6efb-47d0-a86c-04e764487a28",
    "47e36ac4-0185-41c2-992c-d18c57d4a331",
    "9783c0ce-d618-4909-adf9-79b2c9d2f10e",
    "55cd2a51-53b1-47a3-9869-56e3d6bba559",
    "c5758329-0590-4b1f-8447-f64d20c21b96",
    "1abc3b49-cb7a-4d1d-a507-69fd139e57ae",
    "61164b98-a492-4009-b2a9-9c94f01ef8a8",
    "f650e3df-80fa-4e27-b254-3dd802a071a7",
    "015b365f-9bcd-41c4-92fd-9e3e475cbdac",
    "281d8e09-ea24-4aee-9d62-bb945c33fc7a",
    "9f1b6c5b-ff23-4c7e-b3e6-576f36f893d5",
    "3610abcc-b6f4-4a8e-b593-77c165755778",
    "9697e209-d83d-41f3-a51b-8de4de0bbe54",
    "9a4a2f10-f5bd-420f-a71c-3e25f70c2ceb",
    "cfeff396-511e-472b-bd3f-288dff86a343",
    "151656b3-5b14-4397-a293-8c8962ef1075",
    "c8f816f8-836d-4fe6-9ad6-d48fe5fd372d",
    "5473cf88-4fca-4b1c-a978-b1c25589654c",
    "b7ec2e38-e5e8-44f1-9427-229b4c15c443",
    "8f5f4ff5-6322-414f-a26d-38a2ebaaaf58",
    "ad35005d-9bb8-4e59-8df6-c4a164d4be1f",
    "9c95a180-5ae6-4109-b5bf-ca28b3f45c53",
    "c1323b4a-12ec-4906-86d2-fcbc4cc261be",
    "5eba9f0f-94be-45c5-b811-b351b9e81a2d",
    "d4dee91f-ee3f-4153-a78f-2114bf3e5b56",
    "b5c43777-62fb-4841-8044-df9635e168a5",
    "b55f9101-3379-4f7d-8ee5-be8c4662b73d",
    "705909cd-368f-4d89-8bc4-b88e545448aa",
    "6591339a-64fd-419b-82a2-01b4198184f7",
    "e9280c07-148f-4634-86fd-566e2b99ca95",
    "7ce72cef-ca43-47b2-ab98-b98e08c3fd86",
    "48a4f5de-81d3-414d-95c7-b5697e4ec0c7",
    "cb36e5e9-8a8e-4986-9a66-f5f42449042c",
    "c7952fcf-7717-455a-bde4-c91cb60049af",
    "e57f0a5b-0175-4515-afdc-03b328c10d67",
    "b2fa115a-7a45-44da-801c-db58b8bca7fc",
    "7ef066c2-1ec3-4d01-bc63-9bb6656db39d",
    "2bdda40a-c0bd-45df-8a82-746c2b20b2da",
    "bacc7663-1f43-42f6-b8dc-4c66acb4297b",
    "27f62bde-822a-4c0f-ad8e-045040b8e934",
    "31ae9c6f-27fe-4663-9990-73386e96629a",
    "8505dbb5-5f20-4ecd-8f48-7420ae03f534",
    "c2115608-5c5e-43bb-81ed-bcbe6abd5ea4",
    "a7cf5456-3f82-4806-bf09-6f44e1fcab21",
    "79240270-23db-4198-8725-d1089f9318d2",
    "14fcae52-23a2-438b-bb43-39d46e3ea893",
    "6216ec5f-4fbb-49e5-a254-c860c6d1e140",
    "bb0e3364-9e7b-406c-a9d4-02a08704328e",
    "222eaa3f-45f9-41b1-bada-696b546cfb9d",
    "2dd8ea99-5949-489a-9285-2c8b5b85753a",
    "31f8d373-cfbd-43a2-ab82-eb58092c8c97",
    "7b2996dd-8a2c-4f10-acc2-ea5fea34560e",
    "31e5ede1-4cd7-4553-8eef-a1e6f844473b",
    "01260f18-169c-4282-a488-5e3754b791d5",
    "a7ddc1d2-ff9c-465f-85b4-2392dca7bb9e",
    "417d7e8e-b67f-4876-8b49-465edfa3fea5",
    "cdf9e40b-4a7e-4997-9d18-76881e841388",
    "01700388-139b-4619-9912-e9dd256ad138",
    "a4a6b6e8-ee6d-4fcf-9b45-588bca3e9a4c",
    "f7ea2ee2-21fd-4d68-bc6e-09130e4094db",
    "59cd174c-9db8-4d9d-969a-9e512088e070",
    "d8438731-8bbf-43f2-8fab-77e0fd8d648d",
    "09595055-f58b-4553-9c83-5c4b3ea0ccd6",
    "7173c6bb-5ddd-4be4-8d90-c0ca20d026dd",
    "9d6c825d-a33f-4ed8-a655-82d1aeb04f15",
    "14d1d827-d1a4-4987-bebe-fd130d4d6cae",
    "f1bef9fc-7143-496e-b93d-ab012331827c",
    "915ab31b-d6cb-4f46-82be-8b4fd479f3de",
    "94bd5479-d7f3-4dd0-9dae-dedc4c6fa012",
    "3400dd35-a7a0-4698-8f52-cf5a9482137c",
    "8dc7ae8e-a0ca-4145-97dc-081bcdf57ee6",
    "68b78a7d-69e2-4da0-b3e8-f725529b5fb4",
    "85772620-880b-490e-9e48-43802d87fde0",
    "a6fcc1f1-33fd-44d0-9108-ebb4fde83812",
    "cedf9edb-da95-4f11-b2ec-ac4cffaad082",
    "100339e6-fd74-4788-aaa7-7b71393f853b",
    "4e105e28-1ff3-4a0d-a478-edd9cf6f8f19",
    "15a62605-ef22-4abd-9419-f2a774dfd698",
    "fd0c3941-6627-43ad-aef9-ce70ae8e53e0",
    "16cce3db-a5e5-421a-a0fa-77413e6b7060",
    "d0213c8f-ce30-4e1e-bf3a-4ed7b5eac816",
    "57179013-211d-4cd4-8dc0-e7ac67b2e9f0",
    "5f356b4a-3b4e-4dce-876e-053204b8e230",
    "40c0ad24-4542-45f4-ac62-65d3bab424c8",
    "fac7cd78-8b9a-4e25-b42d-fadd6583ee7c",
    "d529028c-3078-46cb-a738-657a6e50e262",
    "e8f57bbe-c013-4218-a264-4e81c5931d3c",
    "facf2af9-736a-4000-a110-90c4635ea36b",
    "89125fd5-2012-4136-ad39-d37df6ed7a78",
    "c16ef372-33dd-4b20-8c7b-2be4772722c9",
    "a1a1e135-11aa-479a-bd55-168fa6141b10",
    "3b5b124f-043e-4069-89b5-b57651c138f3",
    "c2901b26-f8eb-4f96-be7d-47eb644f9680",
    "52352d83-2b00-43c8-a0aa-9e1c2a6a9abd",
    "ed3ee737-a0a6-4013-8634-bd7d71fd0f2c",
    "a41e7dc1-5ef3-4f19-99c6-a9ca573f3b97",
    "9189f6e9-5f5f-4a31-adc1-5a86c23193cd",
    "1fc7d3b0-4729-4917-84b9-65094ff1009a",
    "d48f544c-58a4-4964-9333-dba210753bd2",
    "b833ff49-b040-435c-8011-1e4114c25c32",
    "a1075450-cc65-43d2-9ab9-434f5b7ce915",
    "044dee11-7458-4bc1-8d00-6f6a283ab29f",
    "723fc88c-b62b-40d0-9bff-5b025164e861",
    "544418dd-dc1e-46b2-bc7d-14e800edbeb2",
    "fe740dc8-9f92-4bcb-be96-460f701d3ade",
    "abc4c56f-ca12-4e30-aeb0-4b3b26a47feb",
    "103613db-d963-4296-a2c7-ad7dea7a65e5",
    "8e25e053-8dca-427f-b741-ced1bb04ccc5",
    "b57301f2-c40f-40d0-9526-b0411c2bf5ad",
    "5f27abb2-00c3-4df3-95d7-fbd7cb802d6d",
    "7480295d-0923-475e-a54b-8c8bdcce6984",
    "21f2438a-e000-40cd-a6eb-3ee38c29a563",
    "1ea36c05-0eb3-425e-9cb2-ca9a662d9d3d",
    "5354feb0-d71d-4ebf-b2d2-da9ef2263f6f"
],
      mainDepartmentUser: true,
    }),
  })
  .then(r => r.json())
  .then(data => ({
    questionbanks: data?.results?.questionbanks ?? [],
    count: data?.results?.count ?? 0,
  }));
};

/**
 * Fetch questions inside a specific question bank.
 * Returns { questions: [{question_id, question_name, ...}], count }
 */
export const questionsInBank = (qbId, token) => {
  const raw_token = token.toLowerCase().startsWith("bearer ") ? token.slice(7) : token;

  return fetch("https://api.examly.io/api/v2/questionfilter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": raw_token,
      "origin": "https://admin.orchard.iamneo.in",
      "referer": "https://admin.orchard.iamneo.in/",
    },
    body: JSON.stringify({
      qb_id: qbId,
      type: "Single",
      page: 1,
      limit: 50,
    }),
  })
  .then(r => r.json())
  .then(data => {
    const raw_qs = data?.non_group_questions ?? [];

    const questions = raw_qs.map(q => {
      const q_id = q.q_id ?? "";
      const html = q.question_data ?? "";

      const titleMatch = html.match(/Project Title[:\s\u00a0]*([^<\n\r]{3,120})/i);
      let name;
      if (titleMatch) {
        name = titleMatch[1].trim().replace(/&nbsp;/g, "").trim();
      } else {
        const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        name = plain.slice(0, 80) || `Question ${q_id.slice(0, 8)}`;
      }

      return { question_id: q_id, question_name: name, question_data: html };
    });

    return {
      questions,
      count: data?.number_of_questions ?? questions.length,
    };
  });
};

/**
 * Import a question via the server proxy.
 * Server fetches from examly, embeds images as base64, downloads ZIP.
 * Returns { description, testcases, zip_saved, zip_url, zip_filename,
 *           images_embedded, images_total }.
 * question_data (description HTML) is passed from the frontend because it only
 * exists in the questionsInBank response, not in /api/project_question/:id.
 */
export const importQuestion = (questionId, token, questionData = '') =>
  fetch(`${BASE}/api/import-question`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      question_id:   questionId,
      token,
      question_data: questionData,
    }),
  }).then(r => r.json());

/**
 * Import by pasting the platform API response JSON directly.
 * platformJson: the parsed JSON object from DevTools response tab.
 */
export const importFromJson = (platformJson, token = '') =>
  fetch(`${BASE}/api/import-from-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_json: platformJson, token }),
  }).then(r => r.json());

/** Download the imported boilerplate ZIP as a Blob */
export const getImportedZip = () =>
  fetch(`${BASE}/api/imported-zip`).then(r => {
    if (!r.ok) throw new Error('No imported ZIP found');
    return r.blob();
  });

/**
 * Fetch an auth-gated image via the server proxy, returns base64 data URL.
 * token:       raw token value
 * headerName:  e.g. "Authorization" or "X-Auth-Token" (optional)
 * cookieName:  e.g. "session" or "token" (optional)
 */
export const fetchImage = (url, token, headerName = '', cookieName = '') =>
  fetch(`${BASE}/api/fetch-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, token, header_name: headerName, cookie_name: cookieName }),
  }).then(r => r.json());
