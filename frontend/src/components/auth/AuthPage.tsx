import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

// Keep in sync with the Supabase Email minimum; never apply it to existing-password sign-in.
const MIN_SIGNUP_PASSWORD_LENGTH = 15;

export const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!isLogin && Array.from(password).length < MIN_SIGNUP_PASSWORD_LENGTH) {
      setMessage('비밀번호는 15자 이상 입력해 주세요.');
      return;
    }
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setMessage('로그인 실패: 이메일 또는 비밀번호를 확인해주세요.');
        }
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
            setMessage('회원가입 실패: 다시 시도해주세요.');
        } else if (data.user && !data.session) {
            setMessage('회원가입 성공! 이메일 인증 후 로그인하세요.');
        } else {
            setMessage('회원가입 성공!');
        }
      }
    } catch (err) {
      setMessage('오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#f3f4f6' }}>
      <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)', width: '100%', maxWidth: '400px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#1f2937' }}>
          {isLogin ? 'Medi-Matrix 로그인' : 'Medi-Matrix 회원가입'}
        </h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #d1d5db', outline: 'none' }}
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isLogin ? undefined : MIN_SIGNUP_PASSWORD_LENGTH}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            aria-describedby={isLogin ? undefined : 'medi-signup-password-guidance'}
            style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #d1d5db', outline: 'none' }}
          />

          {!isLogin && (
            <p id="medi-signup-password-guidance" style={{ margin: 0, fontSize: '13px', color: '#4b5563' }}>
              15자 이상으로 입력해 주세요. 공백을 포함한 긴 문장도 사용할 수 있습니다.
            </p>
          )}
          
          <button 
            type="submit" 
            disabled={loading}
            style={{ padding: '0.75rem', borderRadius: '4px', border: 'none', backgroundColor: '#3b82f6', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {loading ? '처리 중...' : (isLogin ? '로그인' : '회원가입')}
          </button>
        </form>

        {message && (
          <p role="status" style={{ marginTop: '1rem', textAlign: 'center', color: message.includes('성공') ? 'green' : 'red', fontSize: '0.875rem' }}>
            {message}
          </p>
        )}

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button 
            onClick={() => { setIsLogin(!isLogin); setMessage(''); }}
            style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isLogin ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
          </button>
        </div>
      </div>
    </div>
  );
};
