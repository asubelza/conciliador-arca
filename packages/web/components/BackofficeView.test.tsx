import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackofficeView } from './BackofficeView';

describe('BackofficeView (backoffice self-service: Tenants/Usuarios tab switcher)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the Tenants tab by default', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<BackofficeView />);
    expect(await screen.findByText('No hay tenants todavía.')).toBeInTheDocument();
    expect(screen.queryByText('No hay usuarios todavía.')).not.toBeInTheDocument();
  });

  it('switches to the Usuarios tab', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<BackofficeView />);
    await screen.findByText('No hay tenants todavía.');

    await userEvent.click(screen.getByRole('button', { name: 'Usuarios' }));
    expect(await screen.findByText('No hay usuarios todavía.')).toBeInTheDocument();
    expect(screen.queryByText('No hay tenants todavía.')).not.toBeInTheDocument();
  });
});
