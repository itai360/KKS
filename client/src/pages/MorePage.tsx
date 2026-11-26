// Every screen in one place (section 28): each group of the menu as a grid of icons, with a search - a page of
// its own beside the side menu.

import { useNavSections } from '../components/Layout';
import { NavMenu } from '../components/NavMenu';
import { PageHead } from '../components/ui';

export function MorePage() {
  const navigation = useNavSections();
  return (
    <div className="page narrow more-page">
      <PageHead title="כל המסכים" docTitle="עוד" sub="כל הכלים של הקורס, במקום אחד." />
      <NavMenu sections={navigation} />
    </div>
  );
}
