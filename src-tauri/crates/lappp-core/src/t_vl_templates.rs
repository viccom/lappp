//! The built-in prompt template library of the image understanding.
//!
//! The library is a set of *lenses* over the same photo: a role to write
//! from (father, mother, son, daughter, bystander) and a theme to read the
//! photo through (parenting, outing, learning, effort). Every template gets
//! the same factual context block — file name, capture time with weekday,
//! part of day and season, place, the people the face annotations named, the
//! exposure and the camera — because a model that only sees a picture
//! guesses the time of day from the light and mislabels an evening shot as
//! "early morning".
//!
//! The shared rules keep the model honest: describe only what is visible,
//! trust the EXIF time over the impression, use a name only when the
//! annotation clearly matches the person, and never invent events,
//! relationships or places. The theme templates are allowed to say "this
//! photo does not show a study scene" — a forced theme produces fiction.
//!
//! Every template returns the same shape, so the annotations stay
//! comparable: a Chinese `caption` and a short array of Chinese `tags`.

/// The output contract shared by every template of the library.
pub const LIBRARY_SYSTEM: &str = "你是家庭相册的记录员。严格只输出一个 JSON 对象，不要输出 Markdown 围栏、解释或多余文字。字段：caption（中文描述，2 到 4 句，总长不超过 120 字）、tags（3 到 8 个中文短词组成的数组）。";

/// The JSON shape the annotations are stored in.
pub const LIBRARY_SPEC: &str = r#"{"caption":"中文描述","tags":"中文标签数组"}"#;

/// The factual context every template starts from.
const CONTEXT: &str = "照片信息：\n\
     文件名：{file_name}\n\
     拍摄时间：{taken_at}（{weekday}，{time_of_day}，{season}）\n\
     拍摄地点：{place}（{location}）\n\
     画面人物（来自人脸标注，按画面从左到右排列，共 {people_count} 人，可能不完整）：{people}\n\
     拍摄参数：{exif_summary}\n\
     相机：{camera}\n\
     画面尺寸：{dimensions}";

/// The rules every template ends with.
const RULES: &str = "规则：\n\
     1. 只描述照片里能看见的内容；看不清的细节直接写“看不清”，不要猜；\n\
     2. 时间、季节、时段一律以上面的拍摄信息为准，不要凭画面光线另作判断，也不要把室内写成户外；\n\
     3. 姓名来自人脸标注，可能有误或缺失，只有明显对得上画面里的人才使用，也不要推断画面外的关系（比如一家人、同事）；\n\
     4. 不要编造人物关系、事件、对话、地名、风景或画面之外发生的事；\n\
     5. 用 JSON 输出：{\"caption\": \"……\", \"tags\": [\"……\", \"……\"]}。";

/// One template of the built-in library.
pub struct BuiltinTemplate {
    /// The name shown in the template manager.
    pub name: &'static str,
    /// The prompt sent to the gateway.
    pub prompt: &'static str,
    /// The system message that fixes the output shape.
    pub system: &'static str,
    /// The JSON shape the annotations are stored in.
    pub spec: &'static str,
}

/// The built-in templates, in the order the template manager lists them.
pub const LIBRARY: &[BuiltinTemplate] = &[
    BuiltinTemplate {
        name: "客观描述",
        prompt: "请客观描述这张照片。\n\n\
             \n\n\
             要求：\n\
             1. 先用一句话交代场景：谁、在什么地方、在做什么、什么光线；\n\
             2. 再写主要人物的人数、大致年龄段、性别外观、表情、动作与彼此的位置关系；\n\
             3. 然后写环境里的关键物件、季节与整体氛围；\n\
             4. 只写画面里能看出来的内容，看不清就写“看不清”。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "爸爸的视角",
        prompt: "你是一位父亲，正在翻看自己给家人拍的照片。请以父亲的口吻写下此刻的心里话。\n\n\
             \n\n\
             要求：\n\
             1. 先写你在画面里看到了什么：人物、动作、表情、光线、环境；\n\
             2. 再写你作为父亲最在意的那一点——孩子的状态、成长、安全、你们的默契，或你想对他说的一句话；\n\
             3. 可以直接称呼画面里的人，但只有姓名明显对得上画面中那个人时才这么叫；\n\
             4. 只有当画面里的人确实是你的家人时才用这个口吻；如果看不出是家人，就如实描述画面，不要编造家庭关系；\n\
             5. 语气克制、有温度，不要喊口号，不要连用感叹号。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "妈妈的视角",
        prompt: "你是一位母亲，正在整理家里这些年的照片。请以母亲的口吻写下这段文字。\n\n\
             \n\n\
             要求：\n\
             1. 先写画面：人物、动作、表情、穿着、光线、环境；\n\
             2. 再写你作为母亲最先注意到的细节——孩子的情绪、长辈的状态、大家是不是疲惫、这一刻是热闹还是安稳；\n\
             3. 可以直接称呼画面里的人，但只有姓名明显对得上画面中那个人时才这么叫；\n\
             4. 只有当画面里的人确实是你的家人时才用这个口吻；如果看不出是家人，就如实描述画面，不要编造家庭关系；\n\
             5. 语气细腻、具体、生活化，不煽情。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "儿子的视角",
        prompt: "照片里有一个男孩。请以他本人的口吻写一小段话，像他长大后翻到这张照片时写下的。\n\n\
             \n\n\
             要求：\n\
             1. 写那天他在哪里、和谁在一起、在做什么；\n\
             2. 写一个当时的小细节或小心情——不必是大事，但要具体；\n\
             3. 用少年到年轻人的口吻，不要写成作文；\n\
             4. 如果照片里其实没有男孩，就改为以画面中孩子的口吻来写。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "女儿的视角",
        prompt: "照片里有一个女孩。请以她本人的口吻写一小段话，像她多年后看到这张照片时写下的。\n\n\
             \n\n\
             要求：\n\
             1. 写那天她在哪里、和谁在一起、在做什么；\n\
             2. 写一个当时的小细节或小心情——颜色、光、某个人的样子或她的一个念头；\n\
             3. 用女孩自己的口吻，不要写成作文；\n\
             4. 如果照片里其实没有女孩，就改为以画面中孩子的口吻来写。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "旁观者记录",
        prompt: "你是一位刚好路过、举起手机按下快门的旁观者。请写下你当时看到的画面。\n\n\
             \n\n\
             要求：\n\
             1. 按从整体到局部的顺序描述：场景、光线、人物、动作、物品、氛围；\n\
             2. 用“看起来”“似乎”表达推测，不要下断言；\n\
             3. 不要猜人物之间的具体关系，也不要给他们安名字；\n\
             4. 语气像一个记录者，不评价、不抒情。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "亲子时光",
        prompt: "请围绕“亲子”这件事来解读这张照片。\n\n\
             \n\n\
             要求：\n\
             1. 写清画面里的相处状态：谁和谁在一起、距离、身体姿态、有没有眼神或动作上的交流；\n\
             2. 指出这一瞬间最值得记下的那个细节；\n\
             3. 结尾写一句关于成长或陪伴的话，克制、不说教；\n\
             4. 如果画面里只有一个人，就如实说明这更像是个人记录，并照实描述。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "游玩出行",
        prompt: "请把这张照片写成一则关于“出去玩”的记录。\n\n\
             \n\n\
             要求：\n\
             1. 先判断画面是否真的像是在外面玩或出行：如果看不出户外、旅途或游玩的迹象，就直接说明这张照片看不出出游场景，然后如实描述画面；\n\
             2. 如果是，写清楚这是在哪里、和谁一起、这个季节的天气给人的感觉；\n\
             3. 写画面里出现的具体景物或物件（花、树、建筑、装备等）；\n\
             4. 写当时的心情或小插曲，但只能从画面能看出来的部分去推；\n\
             5. 不要编造地名、活动、风景或没发生的事。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "学习时刻",
        prompt: "请把这张照片写成一个关于“学习与专注”的片段。\n\n\
             \n\n\
             要求：\n\
             1. 先判断画面是否真的与学习有关：如果看不出在读书、写字、上课或做作业，就直接说明这张照片看不出学习场景，然后如实描述画面；\n\
             2. 如果与学习有关，写清楚谁在学、在什么地方、桌上有什么、专注的样子是什么样；\n\
             3. 写一个与学习有关的细节或变化；\n\
             4. 不要编造书本内容、成绩或老师的话。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "拼搏与坚持",
        prompt: "请把这张照片写成一段关于“拼搏与坚持”的记录。\n\n\
             \n\n\
             要求：\n\
             1. 先判断画面里是否真的有在努力、流汗、比赛、坚持或克服困难的迹象；如果没有，就如实说明这张照片看不出拼搏场面，然后客观描述画面；\n\
             2. 如果有，写清楚是谁、在做什么动作、姿态和神情如何、周围环境怎样；\n\
             3. 写一句关于坚持的话，克制、不喊口号；\n\
             4. 不要编造比赛、成绩或训练情节。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
    BuiltinTemplate {
        name: "家庭合影",
        prompt: "请把这张照片写成一段“家庭合影”的记录。\n\n\
             \n\n\
             要求：\n\
             1. 按站位逐个介绍画面里的人：大致年龄、性别外观、穿着、表情、动作；\n\
             2. 写清合影的场合、背景和光线；\n\
             3. 写一句这个组合里的人在一起的样子（热闹、安静、正式或随意）；\n\
             4. 姓名只在与人脸标注明显对应时使用，不要张冠李戴；\n\
             5. 不要推断画面外的关系，比如一家人、同事、夫妻。\n",
        system: LIBRARY_SYSTEM,
        spec: LIBRARY_SPEC,
    },
];

/// The prompt of a template: the context block and the rules around the
/// template's own body.
pub fn prompt_of(template: &BuiltinTemplate) -> String {
    format!(
        "{}\n\n{}\n\n{}",
        template.prompt, CONTEXT, RULES
    )
}

/// The whole built-in library with the context block applied.
pub fn library() -> Vec<(&'static str, String, &'static str, &'static str)> {
    LIBRARY
        .iter()
        .map(|template| {
            (
                template.name,
                prompt_of(template),
                template.system,
                template.spec,
            )
        })
        .collect()
}
