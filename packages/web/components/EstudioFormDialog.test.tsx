import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EstudioFormDialog } from './EstudioFormDialog';

const ESTUDIO = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'New Estudio',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('EstudioFormDialog (multi-estudio pivot, PR8)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an estudio via POST /api/platform/estudios and calls onSaved + onClose', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ESTUDIO });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(<EstudioFormDialog onClose={onClose} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: 'Nuevo estudio' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nombre'), 'New Estudio');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/platform/estudios'),
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ name: 'New Estudio' });
    expect(onSaved).toHaveBeenCalledWith(ESTUDIO);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and does not call fetch when the name is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<EstudioFormDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('nombre es obligatorio');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = jest.fn();
    render(<EstudioFormDialog onClose={onClose} onSaved={jest.fn()} />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
