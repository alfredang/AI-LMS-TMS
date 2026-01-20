import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { SSGConfig } from './types';

interface EncryptionDecryptionProps {
  config: SSGConfig;
  updateConfig: (updates: Partial<SSGConfig>) => void;
}

const EncryptionDecryption: React.FC<EncryptionDecryptionProps> = ({ config, updateConfig }) => {
  const [plaintext, setPlaintext] = useState('');
  const [ciphertext, setCiphertext] = useState('');
  const [result, setResult] = useState('');

  const provider = config.availableProviders[0]; // Use the first (and only) provider

  const handleEncrypt = async () => {
    if (!plaintext.trim()) {
      alert('Please provide plaintext to encrypt');
      return;
    }

    if (!provider) {
      alert('Training provider not loaded yet. Please wait...');
      return;
    }

    try {
      const response = await fetch('/api/ssg/encrypt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          plaintext
          // No need to pass trainingProviderId - API will use the only one available
        })
      });

      const data = await response.json();
      if (data.success) {
        setResult(`Encrypted: ${data.ciphertext}`);
      } else {
        setResult(`Encryption failed: ${data.error}`);
      }
    } catch (error) {
      setResult('Encryption failed');
    }
  };

  const handleDecrypt = async () => {
    if (!ciphertext.trim()) {
      alert('Please provide ciphertext to decrypt');
      return;
    }

    if (!provider) {
      alert('Training provider not loaded yet. Please wait...');
      return;
    }

    try {
      const response = await fetch('/api/ssg/decrypt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ciphertext
          // No need to pass trainingProviderId - API will use the only one available
        })
      });

      const data = await response.json();
      if (data.success) {
        setResult(`Decrypted: ${data.plaintext}`);
      } else {
        setResult(`Decryption failed: ${data.error}`);
      }
    } catch (error) {
      setResult('Decryption failed');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Encryption/Decryption</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Training Provider</label>
          <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
            {provider ? `${provider.name || 'N/A'} (${provider.uen})` : 'Loading training provider...'}
          </p>
          {!provider && (
            <p className="text-sm text-red-600 mt-1">Please wait for training provider to load</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Plaintext</label>
            <textarea
              value={plaintext}
              onChange={(e) => setPlaintext(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Enter text to encrypt"
              disabled={!provider}
            />
            <Button 
              onClick={handleEncrypt} 
              className="mt-2 w-full"
              disabled={!provider}
            >
              Encrypt
            </Button>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Ciphertext</label>
            <textarea
              value={ciphertext}
              onChange={(e) => setCiphertext(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Enter encrypted text to decrypt"
              disabled={!provider}
            />
            <Button 
              onClick={handleDecrypt} 
              className="mt-2 w-full"
              disabled={!provider}
            >
              Decrypt
            </Button>
          </div>
        </div>

        {result && (
          <div>
            <label className="block text-sm font-medium mb-2">Result</label>
            <div className="bg-gray-100 p-4 rounded-md">
              <pre className="whitespace-pre-wrap break-words text-sm">{result}</pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EncryptionDecryption;