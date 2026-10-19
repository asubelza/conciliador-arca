import { render, screen } from '@testing-library/react';
import { PlatformView } from './PlatformView';

describe('PlatformView (multi-estudio pivot, PR8)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders PlatformEstudios with write controls for admin', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<PlatformView userRole="admin" />);
    expect(await screen.findByText('No hay estudios todavía.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo estudio' })).toBeInTheDocument();
  });

  it('renders PlatformEstudios read-only for colaborador', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<PlatformView userRole="colaborador" />);
    expect(await screen.findByText('No hay estudios todavía.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo estudio' })).not.toBeInTheDocument();
  });
});
