import { DefaultFamilyNode } from "@/components/node/DefaultFamilyNode.tsx";
import { Member } from "@/types/member.ts";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item.tsx";

type Props = {
  member: Member;
};

export const DetailFamilyNode = ({ member }: Props) => {
  return (
    <div className="w-full">
      <DefaultFamilyNode member={member} />
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
