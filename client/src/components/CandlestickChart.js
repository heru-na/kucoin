// client/src/components/CandlestickChart.js
import React, { useEffect, useRef } from 'react';
import { 
    createChart, CandlestickSeries,
} from 'lightweight-charts'; 

// --- CONFIGURATION ---
const WS_URL = 'ws://localhost:3000'; 

export default function CandlestickChart({ symbol = 'SOLUSDTM', interval = '1min' }) {
  // Refs for the DOM element, the chart instance, the data series, and the WebSocket connection
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null); 
  const candleSeriesRef = useRef(null);
  const wsRef = useRef(null);

  // --- 1. CHART INITIALIZATION (Runs once on mount) ---
  useEffect(() => {
    // ADD THIS LOG HERE:
    console.log('Attempting to initialize WebSocket connection...');    
    
    // 🛑 CRITICAL CHECK: Ensure container is ready and chart isn't already created
    if (!chartContainerRef.current || chartRef.current) {
        return;
    }
    
    // 1. Create the chart instance with clean options
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth || 400,      
      height: 400,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333333',
      },
      grid: {
        vertLines: { color: '#eeeeee' },
        horzLines: { color: '#eeeeee' },
      },
      timeScale: { 
        timeVisible: true, 
        secondsVisible: false, // Ensures we display time, not just date
      },
    });
    
    chartRef.current = chart; 

    // 2. Add candlestick series 
    // Uses the generic 'addSeries' with explicit options to ensure stability and pass internal checks.
    const candleSeries = chart.addSeries(CandlestickSeries, { 
        // Color Options
        upColor: '#26a69a',        
        downColor: '#ef5350',      
        wickUpColor: '#26a69a',    
        wickDownColor: '#ef5350',  
        borderUpColor: '#26a69a',  
        borderDownColor: '#ef5350',

        // Price Format (Critical for avoiding assertion failures with trading data)
        priceFormat: {
            type: 'price',
            precision: 4, 
            minMove: 0.0001,
        },
    }); 

    candleSeriesRef.current = candleSeries;

    // 3. Handle window resize to keep the chart filling the container
    const handleResize = () => {
        if(chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
    }
    window.addEventListener('resize', handleResize);

    // 4. Cleanup function: runs on component unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      if(chartRef.current) {
          chartRef.current.remove(); // Cleanly remove the chart instance
          chartRef.current = null;
      }
    };
  }, []); 

  // --- 2. WEBSOCKET CONNECTION & DATA HANDLING (Runs on mount/symbol change) ---
  useEffect(() => {
    // 1. Clean up previous connection 
    if (wsRef.current) {
        wsRef.current.close();
    }
    
    // 2. Open new WebSocket connection to the backend server
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Request initial historical data immediately upon connection
      const historyRequest = {
        topic: 'request_history', 
        symbol: symbol,
        interval: interval
      };

      console.log('historyRequest:', historyRequest);
      ws.send(JSON.stringify(historyRequest));
    };

    ws.onmessage = (msg) => {
      try {
        const message = JSON.parse(msg.data);
        const series = candleSeriesRef.current;
        if (!series) return; 

        // A. Handle Historical Data Load
        if (message.topic === 'history_data') {
            // 🛑 Defensive check before setting data
            if (!Array.isArray(message.data) || message.data.length === 0) {
                console.warn('Received empty or invalid historical data array. Chart remains empty.');
                return; 
            }

            // TEMPORARY DEBUG LOG: Check the final data format and order
            console.log('--- Historical Data Check ---');
            console.log('First candle:', message.data[0]);
            console.log('Last candle:', message.data[message.data.length - 1]);
            console.log('-----------------------------');

            series.setData(message.data); 
            console.log(`Chart loaded with ${message.data.length} historical candles.`);
            return;
        }

        // B. Handle Real-time Candle Update
        // This topic comes from your server.js broadcast
        if (message.topic && message.topic.includes('limitCandle')) {
          const candleData = message.data;
          
          // 🛑 Defensive check for minimum required fields (time, close) before updating
          if (!candleData || !candleData.time || !candleData.close) {
             console.error('Real-time update missing required data (time or close).', candleData);
             return;
          }
          
          series.update(candleData); // Updates the currently forming candle
        }
      } catch (err) {
        console.error('Failed to process WS message or update series:', err);
      }
    };

    ws.onerror = (err) => console.error('Frontend WS error:', err);
    ws.onclose = () => console.warn('Frontend WS closed');

    // Cleanup: Close the connection on unmount
    return () => ws.close();
  }, [symbol, interval]); 

  // --- 3. RENDER ---
  return (
    <div
      ref={chartContainerRef} // This attaches the ref to the div for chart creation
      style={{ width: '100%', height: '400px', marginTop: '20px' }}
    />
  );
}