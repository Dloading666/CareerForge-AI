const fs = require('fs');
const path = 'node_modules/@arco-design/web-react/es/_util/react-dom.js';
let content = fs.readFileSync(path, 'utf8');

// Fix: import createRoot from react-dom/client (React 19 compat)
content = content.replace(
  "import ReactDOM from 'react-dom';",
  "import ReactDOM from 'react-dom';" + String.fromCharCode(10) + "import { createRoot as __arco_cr } from 'react-dom/client';"
);

// Fix: use correct createRoot instead of CopyReactDOM.createRoot (undefined in React 19)
content = content.replace(
  'createRoot = CopyReactDOM.createRoot;',
  'createRoot = __arco_cr;'
);

fs.writeFileSync(path, content);
console.log('Arco react-dom patched for React 19');
