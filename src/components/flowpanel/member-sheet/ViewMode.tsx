import { FamilyNodeContent } from "@/components/node/FamilyNodeContent";
import { Member } from "@/types/member";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";

type Props = {
  member: Member;
};

export const ViewMode = ({ member }: Props) => {
  return (
    <div className="w-full">
      <FamilyNodeContent member={member} largeImage />
      <Item variant="muted" className="mt-2">
        <ItemContent>
          <ItemTitle>Additional Information</ItemTitle>
          <ItemDescription>
            {member.additionalData || <i>No information added yet.</i>}
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
};
