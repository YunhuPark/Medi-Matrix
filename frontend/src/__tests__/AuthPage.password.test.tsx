import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../components/auth/AuthPage';

const calls = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: {
  signInWithPassword: calls.signIn, signUp: calls.signUp,
} } }));

function passwordInput() { return screen.getByPlaceholderText('비밀번호') as HTMLInputElement; }
function enter(password: string) {
  fireEvent.change(screen.getByPlaceholderText('이메일'), { target: { value: 'local-test@example.invalid' } });
  fireEvent.change(passwordInput(), { target: { value: password } });
}
function signupMode() { fireEvent.click(screen.getByRole('button', { name: /계정이 없으신가요/ })); }
function submit() { fireEvent.submit(passwordInput().closest('form')!); }

beforeEach(() => {
  vi.clearAllMocks();
  calls.signIn.mockResolvedValue({ error: null });
  calls.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
});
afterEach(cleanup);

describe('signup-only password length', () => {
  it('rejects14characters before a programmatic signup submission reaches the API', async () => {
    render(<AuthPage />); signupMode(); enter('a'.repeat(14)); submit();
    await screen.findByText(/비밀번호는 15자 이상/);
    expect(calls.signUp).not.toHaveBeenCalled();
  });
  it('accepts15characters at the signup boundary', async () => {
    render(<AuthPage />); signupMode(); enter('a'.repeat(15)); submit();
    await waitFor(() => expect(calls.signUp).toHaveBeenCalledWith({ email: 'local-test@example.invalid', password: 'a'.repeat(15) }));
  });
  it('counts Unicode codepoints rather than UTF16units', async () => {
    render(<AuthPage />); signupMode(); enter('😀'.repeat(14)); submit();
    await screen.findByText(/비밀번호는 15자 이상/);
    expect(calls.signUp).not.toHaveBeenCalled();
    enter('😀'.repeat(15)); submit();
    await waitFor(() => expect(calls.signUp).toHaveBeenCalledWith({ email: 'local-test@example.invalid', password: '😀'.repeat(15) }));
  });
  it('keeps legacy6character passwords available for signin', async () => {
    render(<AuthPage />); enter('old123'); submit();
    await waitFor(() => expect(calls.signIn).toHaveBeenCalledWith({ email: 'local-test@example.invalid', password: 'old123' }));
    expect(calls.signUp).not.toHaveBeenCalled();
  });
  it('does not trim spaces from a signup passphrase', async () => {
    const password = '  a longer passphrase with spaces  ';
    render(<AuthPage />); signupMode(); enter(password); submit();
    await waitFor(() => expect(calls.signUp).toHaveBeenCalledWith({ email: 'local-test@example.invalid', password }));
  });
  it('clears the signup length error when switching back to legacy signin', async () => {
    render(<AuthPage />); signupMode(); enter('a'.repeat(14)); submit();
    await screen.findByText(/비밀번호는 15자 이상/);
    fireEvent.click(screen.getByRole('button', { name: /이미 계정이 있으신가요/ }));
    expect(screen.queryByText(/비밀번호는 15자 이상/)).toBeNull();
    enter('old123'); submit();
    await waitFor(() => expect(calls.signIn).toHaveBeenCalledWith({ email: 'local-test@example.invalid', password: 'old123' }));
  });
  it('adds signup guidance and native constraints, then removes them on signin', () => {
    render(<AuthPage />);
    expect(passwordInput().hasAttribute('minlength')).toBe(false);
    expect(passwordInput().autocomplete).toBe('current-password');
    signupMode();
    expect(passwordInput().minLength).toBe(15);
    expect(passwordInput().autocomplete).toBe('new-password');
    expect(screen.getByText(/15자 이상.*문장/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /이미 계정이 있으신가요/ }));
    expect(passwordInput().hasAttribute('minlength')).toBe(false);
    expect(passwordInput().autocomplete).toBe('current-password');
    expect(screen.queryByText(/15자 이상.*문장/)).not.toBeInTheDocument();
  });
});
