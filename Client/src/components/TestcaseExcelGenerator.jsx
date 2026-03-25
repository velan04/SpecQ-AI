import React, { useState } from 'react';
import { Download, FileSpreadsheet, AlertCircle, CheckCircle, User, Mail, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function TestcaseExcelGenerator() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [questionName, setQuestionName] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [preview, setPreview] = useState([]);

  const sampleJson = `[
  {
    "evaluationType": "Backend",
    "testcases": [
      {"name": "Backend_Test_Method_GetMobileById", "weightage": 0.04},
      {"name": "Backend_Test_Method_GetAllMobiles", "weightage": 0.04}
    ]
  },
  {
    "evaluationType": "Frontend",
    "testcases": [
      {"name": "Frontend_login_component_renders", "weightage": 0.02631},
      {"name": "Frontend_displays_validation_messages", "weightage": 0.02631}
    ]
  }
]`;

  const parseAndPreview = (jsonText) => {
    setError('');
    setSuccess('');
    setPreview([]);

    if (!jsonText.trim()) {
      return;
    }

    try {
      const data = JSON.parse(jsonText);
      
      if (!Array.isArray(data)) {
        setError('JSON must be an array of objects');
        return;
      }

      const testcases = [];
      for (const block of data) {
        // Support both evaluationType (camelCase) and evaluation_type (snake_case)
        const evaluationType = block.evaluationType || block.evaluation_type || '';
        
        if (block.testcases && Array.isArray(block.testcases)) {
          for (const tc of block.testcases) {
            if (tc.name && tc.weightage !== undefined) {
              testcases.push({
                name: tc.name,
                weightage: tc.weightage,
                evaluationType: evaluationType
              });
            }
          }
        }
      }

      if (testcases.length === 0) {
        setError('No valid testcases found in JSON');
        return;
      }

      setPreview(testcases);
      setSuccess(`Found ${testcases.length} testcases`);
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
    }
  };

  const generateExcel = () => {
    if (!name.trim()) {
      setError('Please enter Name');
      return;
    }
    if (!email.trim()) {
      setError('Please enter Email');
      return;
    }
    if (!questionName.trim()) {
      setError('Please enter Question Name');
      return;
    }
    if (preview.length === 0) {
      setError('No testcases to export. Please paste valid JSON first.');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      
      const wsData = [
        ['Name', 'Email', 'Question Name', 'Testcase Name', 'Weightage', 'Marks', 'TC Status', 'Evaluation Type'],
        ...preview.map(tc => [
          name,
          email,
          questionName,
          tc.name,
          tc.weightage,
          tc.weightage,
          'Passed',
          tc.evaluationType
        ])
      ];
      
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      
      ws['!cols'] = [
        { wch: 20 },
        { wch: 30 },
        { wch: 30 },
        { wch: 60 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 20 }
      ];
      
      XLSX.utils.book_append_sheet(wb, ws, 'Testcases');
      XLSX.writeFile(wb, 'testcases.xlsx');
      
      setSuccess('Excel file downloaded successfully!');
    } catch (err) {
      setError(`Error generating Excel: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <FileSpreadsheet className="w-8 h-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-gray-800">Testcase Excel Generator</h1>
          </div>
          
          {/* User Information Section */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">User Information</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <User className="w-4 h-4 inline mr-1" />
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Mail className="w-4 h-4 inline mr-1" />
                  Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <FileText className="w-4 h-4 inline mr-1" />
                  Question Name *
                </label>
                <input
                  type="text"
                  value={questionName}
                  onChange={(e) => setQuestionName(e.target.value)}
                  placeholder="Enter question name"
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Input Section */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-semibold text-gray-700">
                  JSON Input (evaluationType or evaluation_type)
                </label>
                <button
                  onClick={() => {
                    setJsonInput(sampleJson);
                    parseAndPreview(sampleJson);
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  Load Sample
                </button>
              </div>
              <textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  parseAndPreview(e.target.value);
                }}
                placeholder='[{"evaluation_type": "Puppeteer", "testcases": [...]}]'
                className="w-full h-96 p-4 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none font-mono text-sm"
              />
              
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => parseAndPreview(jsonInput)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  Parse JSON
                </button>
                <button
                  onClick={() => {
                    setJsonInput('');
                    setPreview([]);
                    setError('');
                    setSuccess('');
                  }}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Preview Section */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Preview ({preview.length} testcases)
              </label>
              <div className="border-2 border-gray-300 rounded-lg h-96 overflow-auto bg-gray-50">
                {preview.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead className="bg-indigo-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold">#</th>
                        <th className="px-2 py-2 text-left font-semibold">Testcase</th>
                        <th className="px-2 py-2 text-right font-semibold">Weight</th>
                        <th className="px-2 py-2 text-center font-semibold">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((tc, idx) => (
                        <tr key={idx} className="border-t border-gray-200 hover:bg-indigo-50">
                          <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                          <td className="px-2 py-2 text-gray-800 text-xs">{tc.name}</td>
                          <td className="px-2 py-2 text-right text-gray-800">{tc.weightage}</td>
                          <td className="px-2 py-2 text-center">
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                              {tc.evaluationType}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    <p>No testcases to preview</p>
                  </div>
                )}
              </div>

              <button
                onClick={generateExcel}
                disabled={preview.length === 0}
                className={`mt-4 w-full px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition ${
                  preview.length > 0
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Download className="w-5 h-5" />
                Download Excel File
              </button>
            </div>
          </div>

          {/* Messages */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <p className="text-green-800">{success}</p>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-white rounded-lg shadow-xl p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">How to Use</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>Fill in your Name, Email, and Question Name (required fields)</li>
            <li>Paste your JSON data — supports both <code>evaluationType</code> and <code>evaluation_type</code> field names</li>
            <li>The preview will show parsed testcases with their evaluation types</li>
            <li>Click "Download Excel File" to generate testcases.xlsx</li>
          </ol>
          
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-700 mb-2">
              <strong>Excel columns:</strong>
            </p>
            <ul className="text-sm text-gray-600 space-y-1 ml-4">
              <li>• Name, Email, Question Name - From your input (applied to all rows)</li>
              <li>• Testcase Name, Weightage - From JSON</li>
              <li>• Marks - Same as Weightage</li>
              <li>• TC Status - Always "Passed"</li>
              <li>• Evaluation Type - From JSON <code>evaluationType</code> or <code>evaluation_type</code> field</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}