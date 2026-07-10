// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Explain from '@/components/Explain';

afterEach(() => cleanup());

describe('Explain', () => {
  it('renders the definition and the read line when present', () => {
    render(<Explain gloss={{ term: 'Term', define: 'Definition here', read: 'Read here' }} />);
    expect(screen.getByText('Definition here')).toBeTruthy();
    expect(screen.getByText('Read here')).toBeTruthy();
  });

  it('omits the read paragraph when read is null', () => {
    render(<Explain gloss={{ term: 'Term', define: 'Definition here', read: null }} />);
    expect(screen.queryByText('Read here')).toBeNull();
  });
});
