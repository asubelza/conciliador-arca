import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadSummary } from './UploadSummary';

const COUNTS_ALL_MATCHED = {
  arca_rows: 10,
  contabilidad_rows: 10,
  matched: 10,
  'unmatched-arca': 0,
  'unmatched-contabilidad': 0,
  duplicates: 0,
  errors: 0,
};

const COUNTS_WITH_DIFFERENCES = {
  arca_rows: 10,
  contabilidad_rows: 8,
  matched: 6,
  'unmatched-arca': 3,
  'unmatched-contabilidad': 1,
  duplicates: 1,
  errors: 0,
};

describe('T38: UploadSummary', () => {
  it('shows a positive headline and the 7 big numbers when everything matched', () => {
    render(
      <UploadSummary counts={COUNTS_ALL_MATCHED} onViewDetails={jest.fn()} onUploadAnother={jest.fn()} showingDetails={false} />,
    );

    expect(screen.getByText('Carga procesada: todo concilia.')).toBeInTheDocument();
    expect(screen.getAllByText('10')).toHaveLength(3); // arca_rows, contabilidad_rows, matched
    expect(screen.getAllByText('0').length).toBe(4); // unmatched-arca, unmatched-contabilidad, duplicates, errors
  });

  it('shows a mixed headline when there are matches AND discrepancies', () => {
    render(
      <UploadSummary counts={COUNTS_WITH_DIFFERENCES} onViewDetails={jest.fn()} onUploadAnother={jest.fn()} showingDetails={false} />,
    );

    expect(screen.getByText('Carga procesada: hay coincidencias y también diferencias.')).toBeInTheDocument();
  });

  it('shows a no-matches headline when matched is 0', () => {
    render(
      <UploadSummary
        counts={{ ...COUNTS_WITH_DIFFERENCES, matched: 0 }}
        onViewDetails={jest.fn()}
        onUploadAnother={jest.fn()}
        showingDetails={false}
      />,
    );

    expect(screen.getByText('Carga procesada: no se encontraron coincidencias.')).toBeInTheDocument();
  });

  it('calls onViewDetails when "Ver reporte detallado" is clicked, and hides it once showingDetails is true', async () => {
    const onViewDetails = jest.fn();
    const { rerender } = render(
      <UploadSummary counts={COUNTS_ALL_MATCHED} onViewDetails={onViewDetails} onUploadAnother={jest.fn()} showingDetails={false} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /ver reporte detallado/i }));
    expect(onViewDetails).toHaveBeenCalledTimes(1);

    rerender(
      <UploadSummary counts={COUNTS_ALL_MATCHED} onViewDetails={onViewDetails} onUploadAnother={jest.fn()} showingDetails={true} />,
    );
    expect(screen.queryByRole('button', { name: /ver reporte detallado/i })).not.toBeInTheDocument();
  });

  it('calls onUploadAnother when "Subir otro archivo" is clicked', async () => {
    const onUploadAnother = jest.fn();
    render(<UploadSummary counts={COUNTS_ALL_MATCHED} onViewDetails={jest.fn()} onUploadAnother={onUploadAnother} showingDetails={false} />);

    await userEvent.click(screen.getByRole('button', { name: /subir otro archivo/i }));
    expect(onUploadAnother).toHaveBeenCalledTimes(1);
  });

  it('renders a generic headline and no number cards when counts are undefined', () => {
    render(<UploadSummary counts={undefined} onViewDetails={jest.fn()} onUploadAnother={jest.fn()} showingDetails={false} />);

    expect(screen.getByText('Carga procesada.')).toBeInTheDocument();
    expect(screen.queryByText('ARCA')).not.toBeInTheDocument();
  });
});
