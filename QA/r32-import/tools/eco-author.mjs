// Codex-authored test story. No model API or demo story generator is used.
export function authorEco(input){
 const summaries=[
 '유하가 집에서 빨간 공을 가방에 넣고 숲을 지나 정원으로 놀러 가려고 준비해요.',
 '유하가 숲길을 걷다가 가방에서 굴러 나온 빨간 공을 놓쳐요. 유하는 낙엽 뒤에서 나는 소리를 따라가요.',
 '유하가 숲의 낙엽을 살펴보지만 공처럼 둥근 솔방울만 찾아요. 유하는 정원 쪽으로 이어진 자국을 발견해요.',
 '유하가 정원에서 빨간 꽃을 공으로 착각해요. 유하가 꽃을 건드리지 않고 고개를 돌리자 바구니에서 통통 소리가 나요.',
 '유하가 정원의 작은 바구니를 들여다보고 빨간 공을 찾아요. 유하는 공을 주머니에 넣고 손으로 꼭 눌러요.',
 '집에 돌아온 유하가 빨간 공을 작은 상자에 놓아요. 유하는 공 곁에 누워 눈을 감고 쉬어요.'
 ];
 const locations=['home','forest','forest','garden','garden','home'];
 const ko=[
 '집에서 유하가 작은 빨간 공을 꺼냈어요. 유하는 두 손으로 공을 꼭 안았어요. 유하가 공을 살짝 위로 던져 보았어요. 빨간 공이 유하의 두 손으로 돌아왔어요. 유하는 작은 가방을 의자 위에 놓았어요. 유하가 가방 안에 빨간 공을 넣었어요. 가방 안에서 공이 동그랗게 자리를 잡았어요. 유하는 가방의 열린 입구를 한번 보았어요. 유하가 가방끈을 어깨에 단단히 걸쳐 보았어요. 유하는 정원에서 공을 굴리려고 문으로 걸었어요. 유하가 문 앞에서 소리 내어 말했어요. “유하는 숲길을 지나 정원으로 갈 거야.”',
 '유하가 숲길 위로 가볍게 발을 옮겼어요. 작은 가방이 유하의 등에서 살짝 흔들렸어요. 가방 입구로 빨간 공이 조금 나왔어요. 유하가 돌을 피해 옆으로 몸을 돌렸어요. 빨간 공이 가방 밖으로 툭 떨어졌어요. 공이 낙엽 위를 통통 튀며 굴러갔어요. 유하는 그 자리에 멈춰 공을 바라보았어요. 유하가 열린 가방을 앞으로 돌려 보았어요. 가방 안에는 빨간 공이 보이지 않았어요. 유하가 낙엽 쪽으로 천천히 한 걸음 다가갔어요. 낙엽 아래에서 작은 바스락 소리가 들렸어요. 유하는 소리 나는 곳을 손으로 가리켰어요.',
 '유하가 숲길 옆에 몸을 낮춰 앉았어요. 유하는 두 손으로 낙엽을 살짝 밀었어요. 낙엽 아래에 작은 둥근 것이 보였어요. 유하가 둥근 것을 손끝으로 조심히 굴렸어요. 작은 솔방울이 낙엽 밖으로 또르르 나왔어요. 유하는 솔방울을 두 손에 올려 보았어요. 솔방울의 작은 조각들이 손바닥에 까슬하게 닿았어요. 유하는 솔방울을 원래 자리로 살짝 내려놓았어요. 유하가 고개를 돌려 땅을 자세히 보았어요. 흙 위에 가느다란 자국이 길게 이어졌어요. 유하는 정원으로 향하는 자국을 손가락으로 따라갔어요. “유하는 이 자국을 따라가 볼 거야.”',
 '유하가 정원 입구에서 걸음을 잠깐 멈췄어요. 유하는 빨간 꽃을 보고 눈을 크게 떴어요. 둥근 꽃이 빨간 공처럼 멀리서 보였어요. 유하가 꽃 가까이 천천히 얼굴을 가져갔어요. 유하는 꽃을 만지지 않고 두 손을 내렸어요. 꽃 아래에는 가느다란 줄기가 곧게 서 있었어요. 유하가 고개를 돌리자 작은 바구니가 보였어요. 바구니 안에서 작은 통통 소리가 났어요. 유하는 바구니 쪽으로 귀를 가까이 기울였어요. 바구니 옆에 공이 굴러간 자국이 이어졌어요. 유하가 바구니 앞에 두 무릎을 굽혔어요. 유하는 바구니 안을 천천히 들여다보기 시작했어요.',
 '유하가 작은 바구니의 손잡이를 살짝 들었어요. 바구니 안에서 빨간 공이 옆으로 굴렀어요. 유하는 두 손을 바구니 안으로 넣었어요. 유하가 빨간 공을 손바닥으로 가만히 감쌌어요. 공의 매끈한 표면이 손끝에 닿았어요. 유하는 공을 들고 작은 소리로 말했어요. “유하가 찾던 빨간 공이 여기 있었네.” 유하가 가방 입구를 두 손으로 모았어요. 유하는 공을 작은 주머니 안에 넣었어요. 유하가 주머니 위를 손으로 가볍게 눌렀어요. 주머니 속 공이 둥글게 모양을 드러냈어요. 유하는 공을 누르며 집으로 돌아가기 시작했어요.',
 '유하가 집 안으로 천천히 발을 들였어요. 유하는 작은 가방을 의자 위에 내려놓았어요. 유하가 주머니에서 빨간 공을 꺼내 들었어요. 공이 두 손 안에서 가만히 멈췄어요. 유하는 작은 상자를 바닥에 가져다 놓았어요. 유하가 상자 안에 빨간 공을 내려놓았어요. 상자 안의 공이 벽에 기대어 멈췄어요. 유하는 상자 옆으로 작은 이불을 폈어요. 유하가 이불 위에 두 다리를 쭉 뻗었어요. 유하는 빨간 공을 바라보며 고개를 기울였어요. 유하가 두 눈을 천천히 감았어요. 작은 상자와 빨간 공이 유하 곁에 남았어요.'
 ];
 const en=[
 'Yuha puts his red ball in a bag. He wants to play in the garden. He holds the bag with both hands. Then Yuha walks out of his home.',
 'Yuha walks on the little forest path. His red ball drops out of the bag. It rolls away under the dry leaves. Yuha stops and looks for his ball.',
 'Yuha moves the leaves with his hands. He finds a little cone, not his ball. He puts the cone on the ground. A small track leads to the garden.',
 'Yuha sees a round red flower ahead. It looks like his little red ball. He hears a sound inside a basket. Yuha kneels down and looks inside it.',
 'The red ball is in the basket. Yuha picks it up with both hands. He puts the ball in his pocket. His hand holds it all the way home.',
 'Yuha puts his ball in a small box. The ball stays close beside his blanket. Yuha lies down and closes his eyes. His little red ball is home too.'
 ];
 const outline={titleCandidates:['빨간 공은 어디에','유하와 통통 소리','바구니 속 빨간 공'],logline:'유하가 숲과 정원에서 굴러간 빨간 공을 찾아 집으로 돌아오는 이야기예요.',want:'유하가 빨간 공으로 정원에서 놀고 싶어요.',problem:'가방에서 빨간 공이 굴러 나와 낙엽 뒤로 사라져요.',beats:summaries.map((summary,i)=>({index:i+1,type:['setup','want','attempt','turn','resolution','close'][i],summary,characters:['yuha'],settingKey:locations[i]})),twist:'빨간 꽃인 줄 알았던 공은 작은 바구니 안에서 통통 소리를 내고 있었어요.',newWordsKo:['공','주머니','바구니'],newWordsEn:['ball','pocket','basket'],settings:locations.map((backgroundId,i)=>({beatIndex:i+1,backgroundId})),emotionArc:['설렘','놀람','궁금함','기대','기쁨','편안함'],endingType:input.endingType||'home_sleep'};
 const actions=['Yuha puts a red ball into an open bag at home.','Yuha stops on a forest path as a red ball rolls beneath leaves.','Yuha lifts a pine cone from leaves beside a small track.','Yuha kneels beside a basket near a red flower in the garden.','Yuha takes his red ball from the basket and puts it in a pocket.','Yuha lies beside a blanket and a small box containing the red ball at home.'];
 const pages={cover:{title:outline.titleCandidates[0],sceneAction:'Yuha holds a small red ball beside a basket.'},pages:ko.map((textKo,i)=>({pageNo:i+1,beatIndex:i+1,textKo,textEn:en[i],scene:{who:['yuha'],where:locations[i],action:actions[i],emotion:['joy','surprise','curiosity','hope','joy','calm'][i],timeOfDay:i===5?'evening':'day',props:['red ball','small bag']},variantByCharacter:{},isRefrainPage:false,cue:i===5?'ending':'wide-scene'}))};
 return{outline,pages};
}
