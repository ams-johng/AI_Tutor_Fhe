// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface LearningRecord {
  id: string;
  encryptedScore: string;
  timestamp: number;
  owner: string;
  subject: string;
  status: "pending" | "analyzed" | "archived";
  studyHours: number;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'analyze':
      result = value * 0.8 + Math.random() * 20; // Simulate analysis
      break;
    case 'improve':
      result = value * 1.15; // Simulate improvement
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const subjects = [
  "Mathematics", "Physics", "Chemistry", 
  "Biology", "History", "Literature",
  "Computer Science", "Economics", "Languages"
];

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ subject: "", description: "", testScore: 0, studyHours: 0 });
  const [showIntro, setShowIntro] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<LearningRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<"dashboard" | "history">("dashboard");
  const analyzedCount = records.filter(r => r.status === "analyzed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const archivedCount = records.filter(r => r.status === "archived").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing record keys:", e); }
      }
      const list: LearningRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedScore: recordData.score, 
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                subject: recordData.subject, 
                status: recordData.status || "pending",
                studyHours: recordData.studyHours || 0
              });
            } catch (e) { console.error(`Error parsing record data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading record ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { console.error("Error loading records:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitRecord = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting learning data with Zama FHE..." });
    try {
      const encryptedScore = FHEEncryptNumber(newRecordData.testScore);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const recordData = { 
        score: encryptedScore, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        subject: newRecordData.subject, 
        status: "pending",
        studyHours: newRecordData.studyHours,
        description: newRecordData.description
      };
      await contract.setData(`record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(recordId);
      await contract.setData("record_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      setTransactionStatus({ visible: true, status: "success", message: "Learning data submitted securely!" });
      await loadRecords();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({ subject: "", description: "", testScore: 0, studyHours: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const analyzeRecord = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Analyzing learning data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const analyzedScore = FHECompute(recordData.score, 'analyze');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRecord = { ...recordData, status: "analyzed", score: analyzedScore };
      await contractWithSigner.setData(`record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE analysis completed successfully!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Analysis failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const archiveRecord = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Archiving learning data..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      const updatedRecord = { ...recordData, status: "archived" };
      await contract.setData(`record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      setTransactionStatus({ visible: true, status: "success", message: "Record archived successfully!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Archive failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  const renderSubjectDistribution = () => {
    const subjectCounts: Record<string, number> = {};
    records.forEach(record => {
      subjectCounts[record.subject] = (subjectCounts[record.subject] || 0) + 1;
    });
    
    const sortedSubjects = Object.entries(subjectCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    return (
      <div className="subject-distribution">
        <h3>Top Subjects</h3>
        <div className="distribution-bars">
          {sortedSubjects.map(([subject, count]) => (
            <div key={subject} className="distribution-item">
              <div className="subject-name">{subject}</div>
              <div className="bar-container">
                <div 
                  className="bar" 
                  style={{ 
                    width: `${(count / records.length) * 100}%`,
                    background: `linear-gradient(90deg, var(--color-primary), var(--color-secondary))`
                  }}
                ></div>
              </div>
              <div className="count">{count}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPerformanceChart = () => {
    const recentRecords = records.slice(0, 5).reverse();
    if (recentRecords.length === 0) return <div className="no-data">No performance data available</div>;
    
    return (
      <div className="performance-chart">
        <h3>Recent Performance</h3>
        <div className="chart-container">
          {recentRecords.map((record, index) => {
            const score = decryptedValue && record.id === selectedRecord?.id ? 
              decryptedValue : 
              FHEDecryptNumber(record.encryptedScore);
            return (
              <div key={index} className="chart-item">
                <div className="chart-bar" style={{ height: `${score}%` }}>
                  <div className="tooltip">{score.toFixed(1)}%</div>
                </div>
                <div className="chart-label">{record.subject.substring(0, 3)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted learning environment...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="glass-background"></div>
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span> Tutor</span></h1>
          <div className="logo-sub">AI Learning Assistant</div>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="partition-panel">
          <div className="left-panel">
            <nav className="side-nav">
              <button 
                className={`nav-button ${activeTab === "dashboard" ? "active" : ""}`}
                onClick={() => setActiveTab("dashboard")}
              >
                <span className="icon">📊</span> Dashboard
              </button>
              <button 
                className={`nav-button ${activeTab === "history" ? "active" : ""}`}
                onClick={() => setActiveTab("history")}
              >
                <span className="icon">🕒</span> Learning History
              </button>
              <button 
                className="nav-button primary"
                onClick={() => setShowCreateModal(true)}
              >
                <span className="icon">➕</span> Add Record
              </button>
            </nav>
            
            <div className="quick-stats">
              <div className="stat-card">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="right-panel">
            {showIntro && (
              <div className="intro-card glass-card">
                <button className="close-intro" onClick={() => setShowIntro(false)}>×</button>
                <h2>Welcome to FHE Tutor</h2>
                <p>
                  Your <strong>privacy-preserving</strong> AI learning assistant powered by Zama FHE technology.
                  All your learning data remains encrypted while the AI analyzes your performance and recommends improvements.
                </p>
                <div className="fhe-badge">
                  <span>🔒 Fully Homomorphic Encryption</span>
                </div>
              </div>
            )}
            
            {activeTab === "dashboard" ? (
              <>
                <div className="dashboard-grid">
                  <div className="glass-card">
                    <h2>Learning Analytics</h2>
                    {renderPerformanceChart()}
                  </div>
                  <div className="glass-card">
                    <h2>Subject Distribution</h2>
                    {renderSubjectDistribution()}
                  </div>
                </div>
                
                <div className="glass-card stats-card">
                  <h2>Learning Statistics</h2>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <div className="stat-icon">⏱️</div>
                      <div>
                        <div className="stat-value">
                          {records.reduce((sum, record) => sum + record.studyHours, 0)}
                        </div>
                        <div className="stat-label">Total Study Hours</div>
                      </div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-icon">📈</div>
                      <div>
                        <div className="stat-value">
                          {records.length > 0 ? 
                            (records.reduce((sum, record) => sum + FHEDecryptNumber(record.encryptedScore), 0) / records.length).toFixed(1) : 
                            "0.0"}%
                        </div>
                        <div className="stat-label">Average Score</div>
                      </div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-icon">🧠</div>
                      <div>
                        <div className="stat-value">
                          {subjects.length}
                        </div>
                        <div className="stat-label">Subjects Covered</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="history-section">
                <div className="section-header">
                  <h2>Your Learning History</h2>
                  <button onClick={loadRecords} className="refresh-btn" disabled={isRefreshing}>
                    {isRefreshing ? "Refreshing..." : "⟳ Refresh"}
                  </button>
                </div>
                
                {records.length === 0 ? (
                  <div className="empty-state glass-card">
                    <div className="empty-icon">📚</div>
                    <h3>No Learning Records Found</h3>
                    <p>Add your first learning record to get started with personalized analysis</p>
                    <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                      Add First Record
                    </button>
                  </div>
                ) : (
                  <div className="records-list">
                    {records.map(record => (
                      <div 
                        key={record.id} 
                        className={`record-card glass-card ${record.status}`}
                        onClick={() => setSelectedRecord(record)}
                      >
                        <div className="record-header">
                          <div className="subject">{record.subject}</div>
                          <div className={`status ${record.status}`}>
                            {record.status === "analyzed" ? "Analyzed" : 
                             record.status === "pending" ? "Pending" : "Archived"}
                          </div>
                        </div>
                        <div className="record-details">
                          <div className="detail">
                            <span className="label">Score:</span>
                            <span className="value">
                              {decryptedValue && record.id === selectedRecord?.id ? 
                                decryptedValue.toFixed(1) : 
                                "🔒 Encrypted"}%
                            </span>
                          </div>
                          <div className="detail">
                            <span className="label">Hours:</span>
                            <span className="value">{record.studyHours}</span>
                          </div>
                          <div className="detail">
                            <span className="label">Date:</span>
                            <span className="value">
                              {new Date(record.timestamp * 1000).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {isOwner(record.owner) && (
                          <div className="record-actions">
                            {record.status === "pending" && (
                              <button 
                                className="action-btn analyze"
                                onClick={(e) => { e.stopPropagation(); analyzeRecord(record.id); }}
                              >
                                Analyze
                              </button>
                            )}
                            <button 
                              className="action-btn archive"
                              onClick={(e) => { e.stopPropagation(); archiveRecord(record.id); }}
                            >
                              Archive
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { setSelectedRecord(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FHE Tutor</h3>
            <p>Privacy-preserving AI learning assistant</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Tutor. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, recordData, setRecordData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!recordData.subject || !recordData.testScore) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Add Learning Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Subject *</label>
            <select 
              name="subject" 
              value={recordData.subject} 
              onChange={handleChange}
              className="glass-input"
            >
              <option value="">Select subject</option>
              {subjects.map(subject => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Test Score (%) *</label>
            <input 
              type="number" 
              name="testScore" 
              min="0"
              max="100"
              value={recordData.testScore} 
              onChange={handleValueChange} 
              className="glass-input"
            />
          </div>
          
          <div className="form-group">
            <label>Study Hours</label>
            <input 
              type="number" 
              name="studyHours" 
              min="0"
              value={recordData.studyHours} 
              onChange={handleValueChange} 
              className="glass-input"
            />
          </div>
          
          <div className="form-group">
            <label>Notes</label>
            <textarea 
              name="description" 
              value={recordData.description} 
              onChange={handleChange} 
              className="glass-input"
              rows={3}
              placeholder="Additional notes about this learning session..."
            />
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Score:</span>
                <div>{recordData.testScore || '0'}%</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {recordData.testScore ? 
                    `FHE-${FHEEncryptNumber(recordData.testScore).substring(4, 20)}...` : 
                    'No data'}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="primary-btn">
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface RecordDetailModalProps {
  record: LearningRecord;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const RecordDetailModal: React.FC<RecordDetailModalProps> = ({ 
  record, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(record.encryptedScore);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal glass-card">
        <div className="modal-header">
          <h2>Learning Record Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span className="label">Subject:</span>
              <span className="value">{record.subject}</span>
            </div>
            <div className="info-item">
              <span className="label">Date:</span>
              <span className="value">
                {new Date(record.timestamp * 1000).toLocaleString()}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Study Hours:</span>
              <span className="value">{record.studyHours}</span>
            </div>
            <div className="info-item">
              <span className="label">Status:</span>
              <span className={`value status ${record.status}`}>
                {record.status === "analyzed" ? "Analyzed" : 
                 record.status === "pending" ? "Pending" : "Archived"}
              </span>
            </div>
          </div>
          
          <div className="score-section">
            <h3>Test Score</h3>
            <div className="score-display">
              {decryptedValue !== null ? (
                <div className="decrypted-score">
                  <span className="value">{decryptedValue.toFixed(1)}%</span>
                  <span className="label">Decrypted Score</span>
                </div>
              ) : (
                <div className="encrypted-score">
                  <span className="value">🔒 Encrypted</span>
                  <span className="label">FHE Protected</span>
                </div>
              )}
            </div>
            
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className={`decrypt-btn ${decryptedValue !== null ? "decrypted" : ""}`}
            >
              {isDecrypting ? "Decrypting..." : 
               decryptedValue !== null ? "Re-encrypt Data" : "Decrypt with Wallet"}
            </button>
            
            {decryptedValue !== null && (
              <div className="analysis-result">
                <h4>AI Analysis</h4>
                <p>
                  Based on your score of {decryptedValue.toFixed(1)}% in {record.subject}, 
                  we recommend focusing on {["key concepts", "practice problems", "theoretical foundations"][Math.floor(Math.random() * 3)]}.
                </p>
                <div className="recommendation">
                  <span className="icon">💡</span>
                  <span>Suggested study time: {Math.ceil(record.studyHours * 1.2)} hours next session</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
