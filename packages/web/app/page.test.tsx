import { render, screen } from '@testing-library/react';
import Home from './page';
import { clearSession, setSession } from '@/lib/session';

/**
 * T39 (Fase 3, autenticacion-roles): the top-level auth gate — `Home`
 * renders `<LoginForm />` with no session, and the real app (starting with
 * PeriodoSelector, plus the logged-in user's email/role + "Cerrar sesión")
 * once one exists. Everything past that gate (upload flow, período report,
 * role-hidden UI) is covered by each component's own test file.
 */
describe('T39: app/page.tsx (auth gate)', () => {
  afterEach(() => {
    clearSession();
  });

  it('shows the login form when there is no session', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /conciliador inteligente de comprobantes/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant id/i)).not.toBeInTheDocument();
  });

  it('shows the main app + user info + logout once a session exists', () => {
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana' });
    render(<Home />);

    expect(screen.getByLabelText(/tenant id/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });
});
