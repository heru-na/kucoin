// client/src/App.js
import React from 'react';
import CandlestickChart from './components/CandlestickChart';

function App() {
  
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>📈 Live SOLUSDTM Candlestick Chart (Futures)</h1>
      <p>Data streaming from KuCoin via Node.js server on port 3000.</p>
      
      <CandlestickChart symbol="SOLUSDTM" interval="1min" />
    </div>
  );
}

export default App;